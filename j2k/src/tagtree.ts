import type { HeaderBitReader } from "./packets.js";

const UNSETTLED = 0x7fffffff;

export class TagTree {
  private readonly parent: Int32Array;
  private readonly low: Int32Array;
  private readonly value: Int32Array;
  private readonly path: Int32Array;

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error(`tag tree dimensions ${width}x${height} must be positive`);
    }
    const levelSizes: Array<{ w: number; h: number; start: number }> = [];
    let w = width;
    let h = height;
    let total = 0;
    for (;;) {
      levelSizes.push({ w, h, start: total });
      total += w * h;
      if (w === 1 && h === 1) break;
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
    }
    this.parent = new Int32Array(total);
    for (let level = 0; level < levelSizes.length; level++) {
      const cur = levelSizes[level]!;
      if (level === levelSizes.length - 1) {
        this.parent[cur.start] = -1;
        break;
      }
      const up = levelSizes[level + 1]!;
      for (let y = 0; y < cur.h; y++) {
        for (let x = 0; x < cur.w; x++) {
          this.parent[cur.start + y * cur.w + x] = up.start + (y >> 1) * up.w + (x >> 1);
        }
      }
    }
    this.low = new Int32Array(total);
    this.value = new Int32Array(total).fill(UNSETTLED);
    this.path = new Int32Array(levelSizes.length);
  }

  /** Decodes toward leaf `leaf` (its codeblock raster index) until its
   * value is known to be < threshold (true) or >= threshold (false). */
  decode(reader: HeaderBitReader, leaf: number, threshold: number): boolean {
    let depth = 0;
    for (let node = leaf; node !== -1; node = this.parent[node]!) {
      this.path[depth++] = node;
    }
    let low = 0;
    let node = 0;
    for (let i = depth - 1; i >= 0; i--) {
      node = this.path[i]!;
      if (low > this.low[node]!) {
        this.low[node] = low;
      } else {
        low = this.low[node]!;
      }
      while (low < threshold && low < this.value[node]!) {
        if (reader.readBit() === 1) {
          this.value[node] = low;
        } else {
          low++;
        }
      }
      this.low[node] = low;
    }
    return this.value[node]! < threshold;
  }
}
