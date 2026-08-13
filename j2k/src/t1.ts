import { MqDecoder } from "./mq.js";
import type { BandKind } from "./packets.js";

const RUNLENGTH_CX = 17;
const UNIFORM_CX = 18;

// Indexed by packed neighbor significance — horizontal bits 0-1, vertical
// bits 2-3, diagonal bits 4-6 — matching markSignificant's increments.
const ZC_LL_LH = new Uint8Array([
  0, 5, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 1, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2,
  6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2, 6,
  8, 0, 3, 7, 8, 0, 4, 7, 8,
]);
const ZC_HL = new Uint8Array([
  0, 3, 4, 0, 5, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 1, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2,
  3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2, 3,
  4, 0, 6, 7, 7, 0, 8, 8, 8,
]);
const ZC_HH = new Uint8Array([
  0, 1, 2, 0, 1, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 0, 3, 4, 5, 0, 4, 5, 5, 0, 5, 5, 5, 0, 0, 0, 0, 0, 6,
  7, 7, 0, 7, 7, 7, 0, 7, 7, 7, 0, 0, 0, 0, 0, 8, 8, 8, 0, 8, 8, 8, 0, 8, 8, 8, 0, 0, 0, 0, 0, 8, 8,
  8, 0, 8, 8, 8, 0, 8, 8, 8,
]);

const PROCESSED = 1;
const FIRST_MAGNITUDE = 2;

class BitModel {
  private readonly width: number;
  private readonly height: number;
  private readonly zcTable: Uint8Array;
  private readonly decoder: MqDecoder;
  private readonly contexts = new Int8Array(19);
  private readonly neighborhood: Uint8Array;
  readonly doubledMagnitude: Int32Array;
  readonly sign: Uint8Array;
  private readonly flags: Uint8Array;

  constructor(decoder: MqDecoder, width: number, height: number, band: BandKind) {
    this.decoder = decoder;
    this.width = width;
    this.height = height;
    this.zcTable = band === 3 ? ZC_HH : band === 1 ? ZC_HL : ZC_LL_LH;
    const count = width * height;
    this.neighborhood = new Uint8Array(count);
    this.doubledMagnitude = new Int32Array(count);
    this.sign = new Uint8Array(count);
    this.flags = new Uint8Array(count);
    this.contexts[0] = 4 << 1;
    this.contexts[RUNLENGTH_CX] = 3 << 1;
    this.contexts[UNIFORM_CX] = 46 << 1;
  }

  private markSignificant(row: number, column: number, index: number): void {
    const neighborhood = this.neighborhood;
    const width = this.width;
    const left = column > 0;
    const right = column + 1 < width;
    if (row > 0) {
      const up = index - width;
      if (left) neighborhood[up - 1]! += 0x10;
      if (right) neighborhood[up + 1]! += 0x10;
      neighborhood[up]! += 0x04;
    }
    if (row + 1 < this.height) {
      const down = index + width;
      if (left) neighborhood[down - 1]! += 0x10;
      if (right) neighborhood[down + 1]! += 0x10;
      neighborhood[down]! += 0x04;
    }
    if (left) neighborhood[index - 1]! += 0x01;
    if (right) neighborhood[index + 1]! += 0x01;
    neighborhood[index]! |= 0x80;
  }

  private decodeSign(row: number, column: number, index: number): number {
    const width = this.width;
    const doubledMagnitude = this.doubledMagnitude;
    const sign = this.sign;
    let contribution: number;

    // A sign bit s in {0, 1} contributes 1 - 2s, so 1 - sA - sB is the
    // clamped two-neighbor sum.
    const leftSignificant = column > 0 && doubledMagnitude[index - 1]! !== 0;
    if (column + 1 < width && doubledMagnitude[index + 1]! !== 0) {
      const rightSign = sign[index + 1]!;
      contribution = leftSignificant ? 1 - rightSign - sign[index - 1]! : 1 - rightSign - rightSign;
    } else if (leftSignificant) {
      const leftSign = sign[index - 1]!;
      contribution = 1 - leftSign - leftSign;
    } else {
      contribution = 0;
    }
    contribution *= 3;

    const upSignificant = row > 0 && doubledMagnitude[index - width]! !== 0;
    if (row + 1 < this.height && doubledMagnitude[index + width]! !== 0) {
      const downSign = sign[index + width]!;
      contribution += upSignificant ? 1 - downSign - sign[index - width]! : 1 - downSign - downSign;
    } else if (upSignificant) {
      const upSign = sign[index - width]!;
      contribution += 1 - upSign - upSign;
    }

    if (contribution >= 0) {
      return this.decoder.decode(this.contexts, 9 + contribution);
    }
    return this.decoder.decode(this.contexts, 9 - contribution) ^ 1;
  }

  significancePass(oneplushalf: number): void {
    const { width, height, doubledMagnitude, neighborhood, flags } = this;
    const decoder = this.decoder;
    const contexts = this.contexts;
    const zc = this.zcTable;
    for (let stripe = 0; stripe < height; stripe += 4) {
      for (let column = 0; column < width; column++) {
        let index = stripe * width + column;
        const stripeHeight = Math.min(4, height - stripe);
        for (let dy = 0; dy < stripeHeight; dy++, index += width) {
          flags[index]! &= ~PROCESSED;
          if (doubledMagnitude[index]! !== 0 || neighborhood[index]! === 0) continue;
          if (decoder.decode(contexts, zc[neighborhood[index]!]!) === 1) {
            const row = stripe + dy;
            this.sign[index] = this.decodeSign(row, column, index);
            doubledMagnitude[index] = oneplushalf;
            this.markSignificant(row, column, index);
            flags[index]! |= FIRST_MAGNITUDE;
          }
          flags[index]! |= PROCESSED;
        }
      }
    }
  }

  refinementPass(half: number): void {
    const { width, height, doubledMagnitude, neighborhood, flags } = this;
    const decoder = this.decoder;
    const contexts = this.contexts;
    for (let stripe = 0; stripe < height; stripe += 4) {
      for (let column = 0; column < width; column++) {
        let index = stripe * width + column;
        const stripeHeight = Math.min(4, height - stripe);
        for (let dy = 0; dy < stripeHeight; dy++, index += width) {
          if (doubledMagnitude[index]! === 0 || (flags[index]! & PROCESSED) !== 0) continue;
          let cx = 16;
          if ((flags[index]! & FIRST_MAGNITUDE) !== 0) {
            flags[index]! ^= FIRST_MAGNITUDE;
            cx = (neighborhood[index]! & 0x7f) === 0 ? 14 : 15;
          }
          const bit = decoder.decode(contexts, cx);
          doubledMagnitude[index]! += bit === 1 ? half : -half;
          flags[index]! |= PROCESSED;
        }
      }
    }
  }

  cleanupPass(oneplushalf: number): void {
    const { width, height, doubledMagnitude, neighborhood, flags } = this;
    const decoder = this.decoder;
    const contexts = this.contexts;
    const zc = this.zcTable;
    for (let stripe = 0; stripe < height; stripe += 4) {
      const stripeHeight = Math.min(4, height - stripe);
      for (let column = 0; column < width; column++) {
        const top = stripe * width + column;
        let skip = 0;
        if (
          stripeHeight === 4 &&
          flags[top]! === 0 &&
          flags[top + width]! === 0 &&
          flags[top + 2 * width]! === 0 &&
          flags[top + 3 * width]! === 0 &&
          neighborhood[top]! === 0 &&
          neighborhood[top + width]! === 0 &&
          neighborhood[top + 2 * width]! === 0 &&
          neighborhood[top + 3 * width]! === 0
        ) {
          if (decoder.decode(contexts, RUNLENGTH_CX) === 0) continue;
          skip = (decoder.decode(contexts, UNIFORM_CX) << 1) | decoder.decode(contexts, UNIFORM_CX);
          const row = stripe + skip;
          const index = top + skip * width;
          this.sign[index] = this.decodeSign(row, column, index);
          doubledMagnitude[index] = oneplushalf;
          this.markSignificant(row, column, index);
          flags[index]! |= FIRST_MAGNITUDE;
          skip++;
        }
        let index = top + skip * width;
        for (let dy = skip; dy < stripeHeight; dy++, index += width) {
          if (doubledMagnitude[index]! !== 0 || (flags[index]! & PROCESSED) !== 0) continue;
          if (decoder.decode(contexts, zc[neighborhood[index]!]!) === 1) {
            const row = stripe + dy;
            this.sign[index] = this.decodeSign(row, column, index);
            doubledMagnitude[index] = oneplushalf;
            this.markSignificant(row, column, index);
            flags[index]! |= FIRST_MAGNITUDE;
          }
        }
      }
    }
  }
}

export function decodeCodeblock(
  data: Uint8Array,
  start: number,
  length: number,
  width: number,
  height: number,
  band: BandKind,
  numbps: number,
  passes: number,
): Int32Array {
  const decoder = new MqDecoder(data, start, start + length);
  const model = new BitModel(decoder, width, height, band);

  let planePlusOne = numbps;
  let passType = 2;
  for (let pass = 0; pass < passes && planePlusOne >= 1; pass++) {
    const one = 1 << planePlusOne;
    const half = one >> 1;
    const oneplushalf = one | half;
    if (passType === 0) model.significancePass(oneplushalf);
    else if (passType === 1) model.refinementPass(half);
    else model.cleanupPass(oneplushalf);
    if (++passType === 3) {
      passType = 0;
      planePlusOne--;
    }
  }

  const values = model.doubledMagnitude;
  const sign = model.sign;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! >> 1;
    values[i] = sign[i] === 1 ? -v : v;
  }
  return values;
}
