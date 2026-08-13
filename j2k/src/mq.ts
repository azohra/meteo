const QE = new Int32Array([
  0x5601, 0x3401, 0x1801, 0x0ac1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801, 0x3801, 0x3001, 0x2401,
  0x1c01, 0x1601, 0x5601, 0x5401, 0x5101, 0x4801, 0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201,
  0x1c01, 0x1801, 0x1601, 0x1401, 0x1201, 0x1101, 0x0ac1, 0x09c1, 0x08a1, 0x0521, 0x0441, 0x02a1,
  0x0221, 0x0141, 0x0111, 0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005, 0x0001, 0x5601,
]);
const NMPS = new Int32Array([
  1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 45, 46,
]);
const NLPS = new Int32Array([
  1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46,
]);
const SWITCH = new Int32Array([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

export class MqDecoder {
  private readonly data: Uint8Array;
  private readonly end: number;
  private bp: number;
  private chigh: number;
  private clow: number;
  private ct = 0;
  private a: number;

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data;
    this.end = end;
    this.bp = start;
    this.chigh = this.byteAt(start);
    this.clow = 0;
    this.byteIn();
    this.chigh = ((this.chigh << 7) & 0xffff) | ((this.clow >> 9) & 0x7f);
    this.clow = (this.clow << 7) & 0xffff;
    this.ct -= 7;
    this.a = 0x8000;
  }

  // Bytes past the segment decode as 0xFF so renormalization stalls on the
  // marker rule instead of inventing bits.
  private byteAt(index: number): number {
    return index < this.end ? this.data[index]! : 0xff;
  }

  private byteIn(): void {
    let bp = this.bp;
    if (this.byteAt(bp) === 0xff) {
      if (this.byteAt(bp + 1) > 0x8f) {
        this.clow += 0xff00;
        this.ct = 8;
      } else {
        bp++;
        this.clow += this.byteAt(bp) << 9;
        this.ct = 7;
        this.bp = bp;
      }
    } else {
      bp++;
      this.clow += this.byteAt(bp) << 8;
      this.ct = 8;
      this.bp = bp;
    }
    if (this.clow > 0xffff) {
      this.chigh += this.clow >> 16;
      this.clow &= 0xffff;
    }
  }

  decode(contexts: Int8Array, cx: number): number {
    let index = contexts[cx]! >> 1;
    let mps = contexts[cx]! & 1;
    const qe = QE[index]!;
    let d: number;
    let a = this.a - qe;

    if (this.chigh < qe) {
      if (a < qe) {
        a = qe;
        d = mps;
        index = NMPS[index]!;
      } else {
        a = qe;
        d = 1 ^ mps;
        if (SWITCH[index] === 1) mps = d;
        index = NLPS[index]!;
      }
    } else {
      this.chigh -= qe;
      if ((a & 0x8000) !== 0) {
        this.a = a;
        return mps;
      }
      if (a < qe) {
        d = 1 ^ mps;
        if (SWITCH[index] === 1) mps = d;
        index = NLPS[index]!;
      } else {
        d = mps;
        index = NMPS[index]!;
      }
    }
    do {
      if (this.ct === 0) this.byteIn();
      a <<= 1;
      this.chigh = ((this.chigh << 1) & 0xffff) | ((this.clow >> 15) & 1);
      this.clow = (this.clow << 1) & 0xffff;
      this.ct--;
    } while ((a & 0x8000) === 0);
    this.a = a;

    contexts[cx] = (index << 1) | mps;
    return d;
  }
}
