import { parseCodestream } from "./codestream.js";
import { inverseDwt53 } from "./dwt.js";
import type { ResolutionInfo } from "./packets.js";
import { parsePackets } from "./packets.js";
import { placeCodeblock } from "./parallel.js";
import { decodeCodeblock } from "./t1.js";

export interface J2kDecodeResult {
  /** Raw integer samples in raster order, DC-shifted and range-clamped. */
  values: Int32Array;
  width: number;
  height: number;
  bitsPerSample: number;
  isSigned: boolean;
  /** Always 1 in this decoder's subset. */
  componentCount: 1;
}

/**
 * Finishes an assembled tile in place: inverse wavelet over the level
 * ladder, then DC level shift and range clamp.
 */
export function finishTile(
  tile: Int32Array,
  resolutions: ResolutionInfo[],
  bitsPerSample: number,
  isSigned: boolean,
): void {
  inverseDwt53(tile, resolutions);
  const shift = isSigned ? 0 : 1 << (bitsPerSample - 1);
  const min = isSigned ? -(1 << (bitsPerSample - 1)) : 0;
  const max = (isSigned ? 1 << (bitsPerSample - 1) : 1 << bitsPerSample) - 1;
  for (let i = 0; i < tile.length; i++) {
    const v = tile[i]! + shift;
    tile[i] = v < min ? min : v > max ? max : v;
  }
}

/**
 * Decodes a raw JPEG 2000 codestream (SOC..EOC); throws UnsupportedJ2kError
 * for out-of-subset features, J2kFormatError for malformed bytes.
 */
export function decodeJ2k(codestream: Uint8Array): J2kDecodeResult {
  const header = parseCodestream(codestream);
  const { resolutions, tasks } = parsePackets(codestream, header);
  const width = header.width;
  const height = header.height;
  const tile = new Int32Array(width * height);

  for (const task of tasks) {
    const coefficients = decodeCodeblock(
      codestream,
      task.byteOffset,
      task.byteLength,
      task.width,
      task.height,
      task.band,
      task.numbps,
      task.passes,
    );
    placeCodeblock(tile, width, task, coefficients);
  }

  finishTile(tile, resolutions, header.bitsPerSample, header.isSigned);

  return {
    values: tile,
    width,
    height,
    bitsPerSample: header.bitsPerSample,
    isSigned: header.isSigned,
    componentCount: 1,
  };
}
