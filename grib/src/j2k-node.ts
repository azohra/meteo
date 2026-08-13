import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { planDecode } from "@azohra/meteo.j2k";
import type { CodeblockTask } from "@azohra/meteo.j2k";
import type { DecodeJ2k, J2kSamples, J2kScaling } from "./decode.js";
import { DEFAULT_J2K_CODEC, J2K_WORKER_TAG, createRawJ2kDecoder } from "./j2k-worker.js";
import type {
  J2kCodec,
  J2kSampleSpec,
  J2kWorkerData,
  J2kWorkerRequest,
  J2kWorkerRequestBody,
  J2kWorkerResponse,
  RawJ2kDecoderOptions,
} from "./j2k-worker.js";

export type { J2kCodec, RawJ2kDecoderOptions } from "./j2k-worker.js";

/**
 * Instantiates the selected codec and returns a synchronous DecodeJ2k
 * ready to pass to decodeFieldValues.
 */
export async function createNodeJ2kDecoder(options: RawJ2kDecoderOptions = {}): Promise<DecodeJ2k> {
  return createRawJ2kDecoder(options);
}

export interface J2kDecoderPoolOptions {
  /** Worker count; default min(availableParallelism(), 8), at least 1. */
  size?: number;
  /** Codec for <=16-bit codestreams: "j2k" (default) or "wasm"; >16-bit
   * always decodes through @azohra/meteo.j2k. */
  codec?: J2kCodec;
  /** Fan-out shape: "field" (default; one field per worker) or
   * "codeblock" (one field's codeblocks across the whole pool; requires
   * codec "j2k"). */
  strategy?: "field" | "codeblock";
}

export interface J2kDecoderPool {
  /** The number of workers actually spawned. */
  readonly size: number;
  /** A DecodeJ2kAsync for decodeFieldValuesAsync; fan out by issuing
   * decodes concurrently. */
  readonly decode: (codestream: Uint8Array) => Promise<J2kSamples>;
  /** A DecodeJ2kSampled for sampleFieldValuesAsync: one worker decodes
   * only the requested points — region decode wherever @azohra/meteo.j2k
   * carries the codestream, entropy-decoding just the codeblocks the
   * points touch, bit-identical to a full decode by contract — then
   * GRIB-scales and transfers one double per point instead of the whole
   * grid. */
  readonly decodeSampled: (
    codestream: Uint8Array,
    scaling: J2kScaling,
    indices: Uint32Array,
  ) => Promise<Float64Array>;
  /** Terminates the workers; queued and in-flight decodes reject. The
   * pool holds the process open until this is called. */
  close(): Promise<void>;
}

function workerEntry(): URL {
  const compiled = new URL("./j2k-worker.js", import.meta.url);
  return existsSync(fileURLToPath(compiled))
    ? compiled
    : new URL("./j2k-worker.ts", import.meta.url);
}

type J2kJobResponse = Extract<
  J2kWorkerResponse,
  { type: "decoded" } | { type: "sampled" } | { type: "done" }
>;

interface PendingJob {
  body: J2kWorkerRequestBody;
  transfer: ArrayBuffer[];
  resolve: (response: J2kJobResponse) => void;
  reject: (error: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  inFlight: PendingJob | undefined;
}

function samplesFromResponse(
  response: Extract<J2kWorkerResponse, { type: "decoded" }>,
): J2kSamples {
  const values =
    response.kind === "i32"
      ? new Int32Array(response.samples)
      : response.kind === "i16"
        ? new Int16Array(response.samples)
        : new Uint16Array(response.samples);
  return {
    values,
    bitsPerSample: response.bitsPerSample,
    isSigned: response.isSigned,
    componentCount: response.componentCount,
  };
}

const PER_TASK_FIXED_COST = 16;

function partitionTasks(tasks: readonly CodeblockTask[], bins: number): CodeblockTask[][] {
  const k = Math.max(1, Math.min(bins, tasks.length));
  if (tasks.length === 0) return [];
  if (k === 1) return [[...tasks]];
  const byCost = [...tasks].sort((a, b) => b.byteLength - a.byteLength);
  const batches = Array.from({ length: k }, () => ({ cost: 0, tasks: [] as CodeblockTask[] }));
  for (const task of byCost) {
    let lightest = batches[0]!;
    for (const batch of batches) if (batch.cost < lightest.cost) lightest = batch;
    lightest.tasks.push(task);
    lightest.cost += task.byteLength + PER_TASK_FIXED_COST;
  }
  return batches.filter((batch) => batch.tasks.length > 0).map((batch) => batch.tasks);
}

/**
 * Spawns the pool and waits until every worker's codec is instantiated;
 * throws (and cleans up) if any worker fails to boot.
 */
export async function createNodeJ2kDecoderPool(
  options: J2kDecoderPoolOptions = {},
): Promise<J2kDecoderPool> {
  const size = Math.max(1, Math.floor(options.size ?? Math.min(availableParallelism(), 8)));
  const strategy = options.strategy ?? "field";
  // The codeblock strategy only exists for the pure-TS codec, so asking
  // for it without pinning a codec means "j2k", whatever the default.
  const codec = options.codec ?? (strategy === "codeblock" ? "j2k" : DEFAULT_J2K_CODEC);
  if (strategy === "codeblock" && codec !== "j2k") {
    throw new Error(
      'J2K pool strategy "codeblock" requires codec "j2k": the WASM codec decodes whole images only',
    );
  }
  const entry = workerEntry();

  const workers: PoolWorker[] = [];
  const idle: PoolWorker[] = [];
  const queue: PendingJob[] = [];
  let closed = false;
  let nextId = 1;

  const dispatch = (handle: PoolWorker, job: PendingJob): void => {
    handle.inFlight = job;
    const request: J2kWorkerRequest = { ...job.body, id: nextId++ };
    handle.worker.postMessage(request, job.transfer);
  };

  const settleWorker = (handle: PoolWorker): void => {
    const next = queue.shift();
    if (next !== undefined) {
      dispatch(handle, next);
    } else {
      idle.push(handle);
    }
  };

  const failWorker = (handle: PoolWorker, error: Error): void => {
    const job = handle.inFlight;
    handle.inFlight = undefined;
    workers.splice(workers.indexOf(handle), 1);
    const idleAt = idle.indexOf(handle);
    if (idleAt !== -1) idle.splice(idleAt, 1);
    void handle.worker.terminate();
    if (job !== undefined) job.reject(error);
    if (workers.length === 0) {
      for (const queued of queue.splice(0)) queued.reject(error);
    }
  };

  const spawn = (): Promise<PoolWorker> =>
    new Promise((resolve, reject) => {
      const bootData: J2kWorkerData = { __gribJ2kWorker: J2K_WORKER_TAG, codec };
      const worker = new Worker(entry, { workerData: bootData });
      const handle: PoolWorker = { worker, inFlight: undefined };
      let booted = false;
      worker.on("message", (response: J2kWorkerResponse) => {
        if (response.type === "ready") {
          booted = true;
          resolve(handle);
          return;
        }
        if (response.type === "boot-error") {
          void worker.terminate();
          reject(new Error(`J2K pool worker failed to boot: ${response.error}`));
          return;
        }
        const job = handle.inFlight;
        handle.inFlight = undefined;
        if (job === undefined) return;
        if (
          response.type === "decoded" ||
          response.type === "sampled" ||
          response.type === "done"
        ) {
          job.resolve(response);
        } else {
          job.reject(new Error(response.error));
        }
        settleWorker(handle);
      });
      worker.on("error", (error) => {
        if (!booted) {
          void worker.terminate();
          reject(error);
        } else {
          failWorker(handle, error);
        }
      });
      worker.on("exit", (code) => {
        if (booted && !closed && code !== 0) {
          failWorker(handle, new Error(`J2K pool worker exited with code ${code}`));
        }
      });
    });

  const spawned = await Promise.allSettled(Array.from({ length: size }, spawn));
  const failures = spawned.filter((s) => s.status === "rejected");
  if (failures.length > 0) {
    for (const s of spawned) {
      if (s.status === "fulfilled") void s.value.worker.terminate();
    }
    throw (failures[0] as PromiseRejectedResult).reason;
  }
  for (const s of spawned) {
    const handle = (s as PromiseFulfilledResult<PoolWorker>).value;
    workers.push(handle);
    idle.push(handle);
  }

  const submit = (job: PendingJob): void => {
    const handle = idle.pop();
    if (handle !== undefined) {
      dispatch(handle, job);
    } else {
      queue.push(job);
    }
  };

  const runJob = (
    body: J2kWorkerRequestBody,
    transfer: ArrayBuffer[] = [],
  ): Promise<J2kJobResponse> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("J2K decoder pool is closed"));
        return;
      }
      submit({ body, transfer, resolve, reject });
    });

  const decodeCodeblockParallel = async (codestream: Uint8Array): Promise<J2kSamples> => {
    const plan = planDecode(codestream);
    const { width, height, bitsPerSample, isSigned } = plan.header;

    const sharedCodestream = new SharedArrayBuffer(codestream.byteLength);
    new Uint8Array(sharedCodestream).set(codestream);
    const sharedTile = new SharedArrayBuffer(width * height * 4);

    await Promise.all(
      partitionTasks(plan.tasks, size).map((tasks) =>
        runJob({
          kind: "codeblocks",
          codestream: sharedCodestream,
          tile: sharedTile,
          tileWidth: width,
          tasks,
        }),
      ),
    );

    // The finish tail runs in a worker so the main thread stays a scheduler.
    await runJob({
      kind: "finish",
      tile: sharedTile,
      resolutions: plan.resolutions,
      bitsPerSample,
      isSigned,
    });
    return { values: new Int32Array(sharedTile), bitsPerSample, isSigned, componentCount: 1 };
  };

  const decode = (codestream: Uint8Array): Promise<J2kSamples> => {
    if (strategy === "codeblock") {
      return decodeCodeblockParallel(codestream);
    }
    const copy = new Uint8Array(codestream).buffer as ArrayBuffer;
    return runJob({ kind: "field", codestream: copy }, [copy]).then((response) => {
      if (response.type !== "decoded") throw new Error("field decode returned no samples");
      return samplesFromResponse(response);
    });
  };

  // Sampled decodes never fan out: under the region path one worker
  // entropy-decodes only the codeblocks the points touch, so a whole-pool
  // strategy has nothing left to parallelize.
  const decodeSampled = (
    codestream: Uint8Array,
    scaling: J2kScaling,
    indices: Uint32Array,
  ): Promise<Float64Array> => {
    const sample: J2kSampleSpec = {
      indices: new Uint32Array(indices).buffer as ArrayBuffer,
      referenceValue: scaling.referenceValue,
      binaryScale: scaling.binaryScale,
      decimalScale: scaling.decimalScale,
      expectedCount: scaling.expectedCount,
    };
    const copy = new Uint8Array(codestream).buffer as ArrayBuffer;
    return runJob({ kind: "sample", codestream: copy, sample }, [copy, sample.indices]).then(
      (response) => {
        if (response.type !== "sampled") throw new Error("sampled decode returned no samples");
        return new Float64Array(response.samples);
      },
    );
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    const closing = new Error("J2K decoder pool closed");
    for (const queued of queue.splice(0)) queued.reject(closing);
    for (const handle of workers) {
      const job = handle.inFlight;
      handle.inFlight = undefined;
      if (job !== undefined) job.reject(closing);
    }
    await Promise.all(workers.map((handle) => handle.worker.terminate()));
    workers.length = 0;
    idle.length = 0;
  };

  return { size, decode, decodeSampled, close };
}
