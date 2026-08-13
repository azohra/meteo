import type { ResolutionInfo } from "./packets.js";

/** In-place 1-D inverse 5/3 lift of `row[0, lowCount + highCount)` holding
 * the low band in [0, lowCount) and the high band after it, interleaved at
 * `startParity` through the scratch buffer. Exported for the region
 * decoder's windowed lifts (package-internal, not in the public surface). */
export function lift(
  row: Int32Array,
  scratch: Int32Array,
  lowCount: number,
  highCount: number,
  startParity: number,
): void {
  const len = lowCount + highCount;
  if (len === 0) return;
  if (len === 1) {
    // A lone high sample (startParity 1) halves, truncating toward zero.
    if (startParity === 1) row[0] = row[0]! >= 0 ? row[0]! >> 1 : -(-row[0]! >> 1);
    return;
  }

  for (let i = 0; i < lowCount; i++) scratch[startParity + 2 * i] = row[i]!;
  for (let i = 0; i < highCount; i++) scratch[1 - startParity + 2 * i] = row[lowCount + i]!;

  if (startParity === 0) {
    for (let i = 0; i < lowCount; i++) {
      const dPrev = scratch[2 * (i - 1 < 0 ? 0 : i - 1 >= highCount ? highCount - 1 : i - 1) + 1]!;
      const dHere = scratch[2 * (i >= highCount ? highCount - 1 : i) + 1]!;
      scratch[2 * i]! -= (dPrev + dHere + 2) >> 2;
    }
    for (let i = 0; i < highCount; i++) {
      const sHere = scratch[2 * (i >= lowCount ? lowCount - 1 : i)]!;
      const sNext = scratch[2 * (i + 1 >= lowCount ? lowCount - 1 : i + 1)]!;
      scratch[2 * i + 1]! += (sHere + sNext) >> 1;
    }
  } else {
    for (let i = 0; i < lowCount; i++) {
      const sHere = scratch[2 * (i >= highCount ? highCount - 1 : i)]!;
      const sNext = scratch[2 * (i + 1 >= highCount ? highCount - 1 : i + 1)]!;
      scratch[2 * i + 1]! -= (sHere + sNext + 2) >> 2;
    }
    for (let i = 0; i < highCount; i++) {
      const dHere = scratch[2 * (i >= lowCount ? lowCount - 1 : i) + 1]!;
      const dPrev = scratch[2 * (i - 1 < 0 ? 0 : i - 1 >= lowCount ? lowCount - 1 : i - 1) + 1]!;
      scratch[2 * i]! += (dHere + dPrev) >> 1;
    }
  }

  for (let i = 0; i < len; i++) row[i] = scratch[i]!;
}

export function inverseDwt53(tile: Int32Array, resolutions: ResolutionInfo[]): void {
  const final = resolutions[resolutions.length - 1]!;
  const stride = final.width;
  const maxLen = Math.max(final.width, final.height);
  const line = new Int32Array(maxLen);
  const scratch = new Int32Array(maxLen + 1);

  for (let r = 1; r < resolutions.length; r++) {
    const prev = resolutions[r - 1]!;
    const res = resolutions[r]!;
    const rw = res.width;
    const rh = res.height;

    const hsn = prev.width;
    const hdn = rw - hsn;
    const hcas = res.x0 & 1;
    if (rw > 1 || hcas === 1) {
      for (let y = 0; y < rh; y++) {
        const rowStart = y * stride;
        for (let x = 0; x < rw; x++) line[x] = tile[rowStart + x]!;
        lift(line, scratch, hsn, hdn, hcas);
        for (let x = 0; x < rw; x++) tile[rowStart + x] = line[x]!;
      }
    }

    const vsn = prev.height;
    const vdn = rh - vsn;
    const vcas = res.y0 & 1;
    if (rh > 1 || vcas === 1) {
      for (let x = 0; x < rw; x++) {
        for (let y = 0; y < rh; y++) line[y] = tile[y * stride + x]!;
        lift(line, scratch, vsn, vdn, vcas);
        for (let y = 0; y < rh; y++) tile[y * stride + x] = line[y]!;
      }
    }
  }
}
