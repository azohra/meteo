import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import {
  decodeCodeblockTask,
  decodeJ2k,
  decodeRegionFromPlan,
  finishTile,
  placeCodeblock,
  planDecode,
  probeSiz,
} from "@azohra/meteo.j2k";
import type { CodeblockTask, ResolutionInfo } from "@azohra/meteo.j2k";
import type { DecodeJ2k } from "./decode.js";

const require = createRequire(import.meta.url);

/** Which codec decodes <=16-bit codestreams; >16-bit always decodes
 * through @azohra/meteo.j2k. */
export type J2kCodec = "j2k" | "wasm";

/**
 * "j2k" is the production default because the production shape is sampled
 * decode, and under it sampled decode is *region* decode: only the
 * codeblocks the requested points touch are entropy-decoded (~16x faster
 * per core than a full decode on the largest ECCC field, and wire-cost
 * irrelevant either way). Only the pure-TypeScript codec can decode a
 * region — the WASM build decodes whole images only — and it is also the
 * only codec for >16-bit samples. "wasm" stays selectable for full-frame
 * decodes; measured numbers live in j2k/docs/performance.md.
 */
export const DEFAULT_J2K_CODEC: J2kCodec = "j2k";

export interface RawJ2kDecoderOptions {
  /** Codec for <=16-bit codestreams; default "j2k". */
  codec?: J2kCodec;
}

interface CornerstoneDecoder {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned: boolean;
  };
  getDecodedBuffer(): Uint8Array;
}
type CornerstoneFactory = (overrides?: {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<{ J2KDecoder: new () => CornerstoneDecoder }>;

function decodeWithCornerstone(
  decoder: CornerstoneDecoder,
  codestream: Uint8Array,
): ReturnType<DecodeJ2k> {
  decoder.getEncodedBuffer(codestream.length).set(codestream);
  decoder.decode();
  const frame = decoder.getFrameInfo();
  if (frame.componentCount !== 1) {
    throw new Error(
      `JPEG 2000 codestream has ${frame.componentCount} components; GRIB 5.40 carries exactly 1`,
    );
  }
  const sampleCount = frame.width * frame.height;
  const decoded = decoder.getDecodedBuffer();
  const bytesPerSample = frame.bitsPerSample <= 8 ? 1 : 2;
  if (decoded.length !== sampleCount * bytesPerSample) {
    throw new Error(
      `JPEG 2000 decode produced ${decoded.length} bytes for ${sampleCount} samples of ${bytesPerSample} byte(s)`,
    );
  }
  // Samples are copied out: the codec reuses its decode buffer across calls.
  let values: Int16Array | Uint16Array;
  if (bytesPerSample === 1) {
    values = new Uint16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) values[i] = decoded[i]!;
  } else {
    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    if (frame.isSigned) {
      values = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) values[i] = view.getInt16(i * 2, true);
    } else {
      values = new Uint16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) values[i] = view.getUint16(i * 2, true);
    }
  }
  return {
    values,
    bitsPerSample: frame.bitsPerSample,
    isSigned: frame.isSigned,
    componentCount: frame.componentCount,
  };
}

/**
 * Instantiates the selected codec and returns a synchronous DecodeJ2k —
 * the one decoder implementation the main-thread decoder and every pool
 * worker run.
 */
export async function createRawJ2kDecoder(options: RawJ2kDecoderOptions = {}): Promise<DecodeJ2k> {
  const codec = options.codec ?? DEFAULT_J2K_CODEC;
  if (codec === "j2k") {
    return (codestream) => decodeJ2k(codestream);
  }
  // The ./wasmjs export is the real WebAssembly build; the package's main
  // entry is a wasm2js transpile, several times slower.
  const factory = require("@cornerstonejs/codec-openjpeg/wasmjs") as CornerstoneFactory;
  const cornerstone = await factory({ print: () => {}, printErr: () => {} });
  const cornerstoneDecoder = new cornerstone.J2KDecoder();

  return (codestream) => {
    if (probeSiz(codestream).bitsPerSample <= 16) {
      return decodeWithCornerstone(cornerstoneDecoder, codestream);
    }
    // The WASM codec clamps its output to uint16, so deeper samples always
    // decode through @azohra/meteo.j2k.
    return decodeJ2k(codestream);
  };
}

/** workerData tag that arms the bootstrap below. */
export const J2K_WORKER_TAG = "@azohra/meteo.grib j2k-worker";

/** workerData shape the pool spawns workers with. */
export interface J2kWorkerData {
  __gribJ2kWorker: string;
  codec?: J2kCodec;
}

/**
 * The sampled-decode contract: the worker decodes, GRIB-scales, and
 * gathers these full-grid indexes, so the response carries one double per
 * requested point instead of the whole grid.
 */
export interface J2kSampleSpec {
  /** u32 full-grid indexes to gather, transferred. */
  indices: ArrayBuffer;
  referenceValue: number;
  binaryScale: number;
  decimalScale: number;
  /** Section 5's coded-value count; any other decode length throws. */
  expectedCount: number;
}

/**
 * Main thread -> worker: a whole-field decode ("field"), a sampled decode
 * answering only the spec's indexes ("sample" — region decode wherever the
 * pure-TypeScript codec carries the codestream), one batch of
 * independently coded codeblocks placed into a shared tile ("codeblocks"),
 * or the assembly tail on that tile ("finish"). The "codeblocks"/"finish"
 * arms are @azohra/meteo.j2k only.
 */
export type J2kWorkerRequestBody =
  | { kind: "field"; codestream: ArrayBuffer }
  | { kind: "sample"; codestream: ArrayBuffer; sample: J2kSampleSpec }
  | {
      kind: "codeblocks";
      codestream: SharedArrayBuffer;
      tile: SharedArrayBuffer;
      /** The full tile's stride: the image width. */
      tileWidth: number;
      tasks: CodeblockTask[];
    }
  | {
      kind: "finish";
      tile: SharedArrayBuffer;
      resolutions: ResolutionInfo[];
      bitsPerSample: number;
      isSigned: boolean;
    };

export type J2kWorkerRequest = J2kWorkerRequestBody & { id: number };

/** Worker -> main thread; `samples` buffers are transferred back. A
 * "decoded" answers a full-frame decode with raw integer samples; a
 * "sampled" answers a "sample" request with GRIB-scaled doubles, one per
 * requested index. */
export type J2kWorkerResponse =
  | { type: "ready" }
  | { type: "boot-error"; error: string }
  | {
      type: "decoded";
      id: number;
      kind: "u16" | "i16" | "i32";
      samples: ArrayBuffer;
      bitsPerSample: number;
      isSigned: boolean;
      componentCount: number;
    }
  | { type: "sampled"; id: number; samples: ArrayBuffer }
  | { type: "done"; id: number }
  | { type: "decode-error"; id: number; error: string };

/** Validates decoded raw samples against the spec, then scales and
 * gathers them at the spec's indexes. */
export function scaleAndGather(
  raw: { values: ArrayLike<number>; bitsPerSample: number },
  spec: J2kSampleSpec,
): Float64Array {
  if (raw.values.length !== spec.expectedCount) {
    throw new Error(
      `GRIB JPEG 2000 codestream decoded to ${raw.values.length} samples but section 5 declares ${spec.expectedCount}`,
    );
  }
  const indices = new Uint32Array(spec.indices);
  const out = new Float64Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]!;
    if (index >= raw.values.length) {
      throw new Error(`sample index ${index} is outside the ${raw.values.length}-sample field`);
    }
    out[i] = (raw.values[index]! * spec.binaryScale + spec.referenceValue) * spec.decimalScale;
  }
  return out;
}

/**
 * The region-decode sampled path: entropy-decodes only the codeblocks the
 * spec's indexes touch and reconstructs those points exactly
 * (@azohra/meteo.j2k's documented contract: bit-identical to a full
 * decode), then GRIB-scales them. Pure TypeScript, so it carries every bit
 * depth — 20-bit RAQDPS included.
 */
export function decodeSampledRegion(codestream: Uint8Array, spec: J2kSampleSpec): Float64Array {
  const plan = planDecode(codestream);
  const samples = plan.header.width * plan.header.height;
  if (samples !== spec.expectedCount) {
    throw new Error(
      `GRIB JPEG 2000 codestream decodes to ${samples} samples but section 5 declares ${spec.expectedCount}`,
    );
  }
  const indices = new Uint32Array(spec.indices);
  const region = decodeRegionFromPlan(codestream, plan, indices);
  const out = new Float64Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    out[i] = (region.values[i]! * spec.binaryScale + spec.referenceValue) * spec.decimalScale;
  }
  return out;
}

/**
 * One sampled decode, routed like createRawJ2kDecoder routes full decodes:
 * region decode wherever @azohra/meteo.j2k carries the codestream — codec
 * "j2k" always, and >16-bit codestreams under any codec — and a whole-image
 * WASM decode plus gather under codec "wasm" for <=16-bit codestreams (the
 * WASM build cannot decode a region).
 */
export function decodeSampled(
  codestream: Uint8Array,
  spec: J2kSampleSpec,
  codec: J2kCodec,
  decode: DecodeJ2k,
): Float64Array {
  if (codec === "wasm" && probeSiz(codestream).bitsPerSample <= 16) {
    return scaleAndGather(decode(codestream), spec);
  }
  return decodeSampledRegion(codestream, spec);
}

/** Tier-1 over one batch of tasks, coefficients placed straight into the
 * shared tile. */
export function decodeCodeblockBatch(
  codestream: Uint8Array,
  tile: Int32Array,
  tileWidth: number,
  tasks: readonly CodeblockTask[],
): void {
  for (const task of tasks) {
    const coefficients = decodeCodeblockTask(
      codestream.subarray(task.byteOffset, task.byteOffset + task.byteLength),
      task,
    );
    placeCodeblock(tile, tileWidth, task, coefficients);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Without the tag check, merely importing this module inside another
// harness's worker thread would answer that harness's parentPort.
const bootData = workerData as Partial<J2kWorkerData> | null | undefined;
if (parentPort !== null && bootData?.__gribJ2kWorker === J2K_WORKER_TAG) {
  const port = parentPort;
  const post = (response: J2kWorkerResponse, transfer?: ArrayBuffer[]) => {
    port.postMessage(response, transfer ?? []);
  };
  createRawJ2kDecoder({ codec: bootData.codec }).then(
    (decode) => {
      port.on("message", (request: J2kWorkerRequest) => {
        try {
          if (request.kind === "codeblocks") {
            decodeCodeblockBatch(
              new Uint8Array(request.codestream),
              new Int32Array(request.tile),
              request.tileWidth,
              request.tasks,
            );
            post({ type: "done", id: request.id });
            return;
          }
          if (request.kind === "finish") {
            const tile = new Int32Array(request.tile);
            finishTile(tile, request.resolutions, request.bitsPerSample, request.isSigned);
            post({ type: "done", id: request.id });
            return;
          }
          if (request.kind === "sample") {
            const gathered = decodeSampled(
              new Uint8Array(request.codestream),
              request.sample,
              bootData.codec ?? DEFAULT_J2K_CODEC,
              decode,
            );
            post({ type: "sampled", id: request.id, samples: gathered.buffer as ArrayBuffer }, [
              gathered.buffer as ArrayBuffer,
            ]);
            return;
          }
          const result = decode(new Uint8Array(request.codestream));
          const kind =
            result.values instanceof Int32Array
              ? "i32"
              : result.values instanceof Int16Array
                ? "i16"
                : "u16";
          post(
            {
              type: "decoded",
              id: request.id,
              kind,
              samples: result.values.buffer as ArrayBuffer,
              bitsPerSample: result.bitsPerSample,
              isSigned: result.isSigned,
              componentCount: result.componentCount,
            },
            [result.values.buffer as ArrayBuffer],
          );
        } catch (error) {
          post({ type: "decode-error", id: request.id, error: errorText(error) });
        }
      });
      post({ type: "ready" });
    },
    (error: unknown) => {
      post({ type: "boot-error", error: errorText(error) });
    },
  );
}
