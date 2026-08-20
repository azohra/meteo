import type { CodestreamHeader } from "./codestream.js";
import { J2kFormatError, UnsupportedJ2kError } from "./errors.js";
import { TagTree } from "./tagtree.js";

/** Band orientation: LL=0, HL=1, LH=2, HH=3 (codestream band order). */
export type BandKind = 0 | 1 | 2 | 3;

/** One codeblock's self-contained, serializable decode work order. */
export interface CodeblockTask {
  /** Codeword segment as offsets into the codestream buffer. */
  byteOffset: number;
  byteLength: number;
  /** Codeblock extent in band coordinates. */
  width: number;
  height: number;
  band: BandKind;
  /** Magnitude bitplanes to decode: band Mb minus zero bitplanes. */
  numbps: number;
  passes: number;
  /** Where the decoded coefficients land in the tile buffer. */
  tileX: number;
  tileY: number;
}

/** One resolution level's extent on the reference grid. */
export interface ResolutionInfo {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

export interface PacketPlan {
  resolutions: ResolutionInfo[];
  tasks: CodeblockTask[];
}

const ceilDiv2 = (value: number, exponent: number): number => Math.ceil(value / 2 ** exponent);

const floorLog2 = (value: number): number => 31 - Math.clz32(value);

export class HeaderBitReader {
  private readonly data: Uint8Array;
  private readonly end: number;
  position: number;
  private buffer = 0;
  private bufferSize = 0;
  private skipNextBit = false;

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data;
    this.end = end;
    this.position = start;
  }

  readBit(): number {
    return this.readBits(1);
  }

  readBits(count: number): number {
    if (count > 25) {
      // 25 pending bits is the most the 32-bit accumulator can hold before
      // the next byte shifts in.
      throw new J2kFormatError(`packet header field of ${count} bits exceeds the 25-bit reader`);
    }
    while (this.bufferSize < count) {
      if (this.position >= this.end) {
        throw new J2kFormatError("packet header runs past the end of the tile-part");
      }
      const b = this.data[this.position]!;
      this.position++;
      if (this.skipNextBit) {
        this.buffer = (this.buffer << 7) | b;
        this.bufferSize += 7;
        this.skipNextBit = false;
      } else {
        this.buffer = (this.buffer << 8) | b;
        this.bufferSize += 8;
      }
      if (b === 0xff) this.skipNextBit = true;
    }
    this.bufferSize -= count;
    return (this.buffer >>> this.bufferSize) & ((1 << count) - 1);
  }

  alignToByte(): void {
    this.bufferSize = 0;
    // A header ending in 0xFF still owes its stuffing byte.
    if (this.skipNextBit) {
      this.position++;
      this.skipNextBit = false;
    }
  }

  takeBytes(count: number): number {
    const at = this.position;
    if (at + count > this.end) {
      throw new J2kFormatError(`packet body of ${count} bytes runs past the end of the tile-part`);
    }
    this.position += count;
    return at;
  }
}

function readPassCount(reader: HeaderBitReader): number {
  if (reader.readBit() === 0) return 1;
  if (reader.readBit() === 0) return 2;
  let value = reader.readBits(2);
  if (value < 3) return 3 + value;
  value = reader.readBits(5);
  if (value < 31) return 6 + value;
  return 37 + reader.readBits(7);
}

interface Band {
  kind: BandKind;
  tbx0: number;
  tby0: number;
  tbx1: number;
  tby1: number;
  placeX: number;
  placeY: number;
  mb: number;
}

function bandRect(
  header: CodestreamHeader,
  nb: number,
  xob: number,
  yob: number,
): { tbx0: number; tby0: number; tbx1: number; tby1: number } {
  const ox = 2 ** (nb - 1) * xob;
  const oy = 2 ** (nb - 1) * yob;
  return {
    tbx0: ceilDiv2(header.x0 - ox, nb),
    tby0: ceilDiv2(header.y0 - oy, nb),
    tbx1: ceilDiv2(header.x1 - ox, nb),
    tby1: ceilDiv2(header.y1 - oy, nb),
  };
}

function resolutionLadder(header: CodestreamHeader): ResolutionInfo[] {
  const n = header.decompositionLevels;
  const resolutions: ResolutionInfo[] = [];
  for (let r = 0; r <= n; r++) {
    const shift = n - r;
    const x0 = ceilDiv2(header.x0, shift);
    const y0 = ceilDiv2(header.y0, shift);
    resolutions.push({
      x0,
      y0,
      width: ceilDiv2(header.x1, shift) - x0,
      height: ceilDiv2(header.y1, shift) - y0,
    });
  }
  return resolutions;
}

function bandsOf(header: CodestreamHeader, r: number, resolutions: ResolutionInfo[]): Band[] {
  const n = header.decompositionLevels;
  const guard = header.guardBits;
  const mbOf = (exponentIndex: number): number => {
    const exponent = header.exponents[exponentIndex];
    if (exponent === undefined) {
      throw new J2kFormatError(`QCD has no exponent for subband index ${exponentIndex}`);
    }
    const mb = exponent + guard - 1;
    if (mb < 0 || mb > 30) {
      throw new J2kFormatError(`subband Mb ${mb} outside the int32 carrier's [0, 30]`);
    }
    return mb;
  };
  if (r === 0) {
    const rect = bandRect(header, n, 0, 0);
    return [{ kind: 0, ...rect, placeX: 0, placeY: 0, mb: mbOf(0) }];
  }
  const nb = n - r + 1;
  const prev = resolutions[r - 1]!;
  const kinds: Array<{ kind: BandKind; xob: number; yob: number }> = [
    { kind: 1, xob: 1, yob: 0 },
    { kind: 2, xob: 0, yob: 1 },
    { kind: 3, xob: 1, yob: 1 },
  ];
  return kinds.map(({ kind, xob, yob }) => {
    const rect = bandRect(header, nb, xob, yob);
    return {
      kind,
      ...rect,
      placeX: xob === 1 ? prev.width : 0,
      placeY: yob === 1 ? prev.height : 0,
      mb: mbOf(3 * (r - 1) + kind),
    };
  });
}

const DEFAULT_PRECINCT_SIZE = 1 << 15;

export function parsePackets(codestream: Uint8Array, header: CodestreamHeader): PacketPlan {
  const resolutions = resolutionLadder(header);
  const reader = new HeaderBitReader(codestream, header.bodyStart, header.bodyEnd);
  const tasks: CodeblockTask[] = [];
  const cbw = header.codeblockWidth;
  const cbh = header.codeblockHeight;

  for (let r = 0; r < resolutions.length; r++) {
    const res = resolutions[r]!;
    if (res.width === 0 || res.height === 0) continue;

    const pgx0 = Math.floor(res.x0 / DEFAULT_PRECINCT_SIZE);
    const pgy0 = Math.floor(res.y0 / DEFAULT_PRECINCT_SIZE);
    const pgx1 = Math.ceil((res.x0 + res.width) / DEFAULT_PRECINCT_SIZE);
    const pgy1 = Math.ceil((res.y0 + res.height) / DEFAULT_PRECINCT_SIZE);
    if ((pgx1 - pgx0) * (pgy1 - pgy0) > 1 && header.progressionOrder > 2) {
      throw new UnsupportedJ2kError(
        "position-major progression with several precincts",
        `progression order ${header.progressionOrder} over ` +
          `${(pgx1 - pgx0) * (pgy1 - pgy0)} precincts at resolution ${r}; ` +
          "only LRCP/RLCP/RPCL degenerate to resolution-then-precinct order",
      );
    }
    const bandDivisor = r === 0 ? 1 : 2;
    const bands = bandsOf(header, r, resolutions);

    for (let ppy = pgy0; ppy < pgy1; ppy++) {
      for (let ppx = pgx0; ppx < pgx1; ppx++) {
        reader.alignToByte();
        const contributions: Array<{ task: Omit<CodeblockTask, "byteOffset">; length: number }> =
          [];
        if (reader.readBit() === 1) {
          for (const band of bands) {
            if (band.tbx1 - band.tbx0 === 0 || band.tby1 - band.tby0 === 0) continue;
            const pbx0 = Math.max(band.tbx0, (ppx * DEFAULT_PRECINCT_SIZE) / bandDivisor);
            const pbx1 = Math.min(band.tbx1, ((ppx + 1) * DEFAULT_PRECINCT_SIZE) / bandDivisor);
            const pby0 = Math.max(band.tby0, (ppy * DEFAULT_PRECINCT_SIZE) / bandDivisor);
            const pby1 = Math.min(band.tby1, ((ppy + 1) * DEFAULT_PRECINCT_SIZE) / bandDivisor);
            if (pbx0 >= pbx1 || pby0 >= pby1) continue;
            const gx0 = Math.floor(pbx0 / cbw);
            const gy0 = Math.floor(pby0 / cbh);
            const gw = Math.ceil(pbx1 / cbw) - gx0;
            const gh = Math.ceil(pby1 / cbh) - gy0;
            const inclusion = new TagTree(gw, gh);
            const zeroBitplanes = new TagTree(gw, gh);
            for (let gy = 0; gy < gh; gy++) {
              for (let gx = 0; gx < gw; gx++) {
                const leaf = gy * gw + gx;
                if (!inclusion.decode(reader, leaf, 1)) continue;
                let zb = 0;
                while (!zeroBitplanes.decode(reader, leaf, zb + 1)) zb++;
                const numbps = band.mb - zb;
                if (numbps < 0) {
                  throw new J2kFormatError(
                    `codeblock declares ${zb} zero bitplanes against subband Mb ${band.mb}`,
                  );
                }
                const passes = readPassCount(reader);
                let lblock = 3;
                while (reader.readBit() === 1) lblock++;
                const length = reader.readBits(lblock + floorLog2(passes));

                const x0 = Math.max((gx0 + gx) * cbw, pbx0);
                const y0 = Math.max((gy0 + gy) * cbh, pby0);
                const x1 = Math.min((gx0 + gx + 1) * cbw, pbx1);
                const y1 = Math.min((gy0 + gy + 1) * cbh, pby1);
                contributions.push({
                  task: {
                    byteLength: length,
                    width: x1 - x0,
                    height: y1 - y0,
                    band: band.kind,
                    numbps,
                    passes,
                    tileX: band.placeX + (x0 - band.tbx0),
                    tileY: band.placeY + (y0 - band.tby0),
                  },
                  length,
                });
              }
            }
          }
        }
        reader.alignToByte();
        for (const { task, length } of contributions) {
          tasks.push({ ...task, byteOffset: reader.takeBytes(length) });
        }
      }
    }
  }

  if (reader.position !== header.bodyEnd) {
    throw new J2kFormatError(
      `${header.bodyEnd - reader.position} unread bytes after the final packet — ` +
        "the packet walk and the tile-part disagree",
    );
  }
  return { resolutions, tasks };
}
