import { createHash } from "node:crypto";

const N = 624;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
const TWO_PI = 6.283185307179586;

/** CPython's random.Random: MT19937 seeded with init_by_array. */
export class PythonRandom {
  private readonly mt = new Uint32Array(N);
  private mti = N + 1;
  private gaussNext: number | null = null;

  /** key: the seed integer's 32-bit words, least significant first. */
  constructor(key: Uint32Array) {
    if (key.length === 0) {
      throw new Error("PythonRandom requires at least one key word");
    }
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k; k -= 1) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ (Math.imul(prev, 1664525) >>> 0)) + key[j] + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
      if (j >= key.length) {
        j = 0;
      }
    }
    for (let k = N - 1; k; k -= 1) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ (Math.imul(prev, 1566083941) >>> 0)) - i) >>> 0;
      i += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
    this.mti = N;
  }

  private initGenrand(seed: number): void {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < N; i += 1) {
      this.mt[i] = (Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
    }
    this.mti = N;
  }

  private genrandUint32(): number {
    if (this.mti >= N) {
      const mt = this.mt;
      for (let kk = 0; kk < N; kk += 1) {
        const y = ((mt[kk] & UPPER_MASK) | (mt[(kk + 1) % N] & LOWER_MASK)) >>> 0;
        mt[kk] = (mt[(kk + 397) % N] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      this.mti = 0;
    }
    let y = this.mt[this.mti];
    this.mti += 1;
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }

  getrandbits(k: number): number {
    if (!(k > 0 && k <= 32)) {
      throw new Error(`getrandbits(${k}) is outside the supported 1..32 range`);
    }
    return this.genrandUint32() >>> (32 - k);
  }

  private randbelow(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) {
      r = this.getrandbits(k);
    }
    return r;
  }

  shuffle(items: unknown[]): void {
    for (let i = items.length - 1; i >= 1; i -= 1) {
      const j = this.randbelow(i + 1);
      const swapped = items[i];
      items[i] = items[j];
      items[j] = swapped;
    }
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  gauss(mu: number, sigma: number): number {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * TWO_PI;
      const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}

export function randomFromMaterial(material: string): PythonRandom {
  const digest = createHash("sha256").update(material, "utf-8").digest();
  const words: number[] = [];
  for (let offset = digest.length - 4; offset >= 0; offset -= 4) {
    words.push(digest.readUInt32BE(offset));
  }
  // Most-significant zero words never enter init_by_array; a zero integer
  // still contributes one word.
  while (words.length > 1 && words[words.length - 1] === 0) {
    words.pop();
  }
  return new PythonRandom(Uint32Array.from(words));
}
