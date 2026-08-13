import { J2kFormatError, UnsupportedJ2kError } from "./errors.js";

const SOC = 0xff4f;
const SIZ = 0xff51;
const COD = 0xff52;
const COC = 0xff53;
const TLM = 0xff55;
const PLM = 0xff57;
const PLT = 0xff58;
const QCD = 0xff5c;
const QCC = 0xff5d;
const RGN = 0xff5e;
const POC = 0xff5f;
const PPM = 0xff60;
const PPT = 0xff61;
const CRG = 0xff63;
const COM = 0xff64;
const SOT = 0xff90;
const SOD = 0xff93;
const EOC = 0xffd9;

const SKIPPED_MAIN = new Set([COM, TLM, PLM, CRG]);
const SKIPPED_TILE = new Set([COM, PLT]);

function markerName(marker: number): string {
  return `0x${marker.toString(16)}`;
}

/** The parsed, subset-checked main and tile-part headers of a codestream. */
export interface CodestreamHeader {
  /** Image (== tile == component) region on the reference grid. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  bitsPerSample: number;
  isSigned: boolean;
  decompositionLevels: number;
  codeblockWidth: number;
  codeblockHeight: number;
  /** Code table A.16 value. */
  progressionOrder: number;
  guardBits: number;
  /** One exponent per subband in QCD order: LL, then HL/LH/HH per
   * resolution level ascending. */
  exponents: number[];
  /** The single tile-part's packet bitstream, as offsets into the
   * codestream buffer. */
  bodyStart: number;
  bodyEnd: number;
}

function u8(data: Uint8Array, offset: number): number {
  const v = data[offset];
  if (v === undefined) throw new J2kFormatError(`read past end at offset ${offset}`);
  return v;
}

function u16(data: Uint8Array, offset: number): number {
  return u8(data, offset) * 0x100 + u8(data, offset + 1);
}

function u32(data: Uint8Array, offset: number): number {
  return u16(data, offset) * 0x10000 + u16(data, offset + 2);
}

interface SizInfo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bitsPerSample: number;
  isSigned: boolean;
}

function parseSiz(cs: Uint8Array, at: number, length: number): SizInfo {
  if (length < 41) throw new J2kFormatError(`SIZ length ${length} is too short`);
  const x1 = u32(cs, at + 6);
  const y1 = u32(cs, at + 10);
  const x0 = u32(cs, at + 14);
  const y0 = u32(cs, at + 18);
  const xt = u32(cs, at + 22);
  const yt = u32(cs, at + 26);
  const xt0 = u32(cs, at + 30);
  const yt0 = u32(cs, at + 34);
  const components = u16(cs, at + 38);
  if (x1 <= x0 || y1 <= y0) {
    throw new J2kFormatError(`SIZ declares an empty image (${x0},${y0})-(${x1},${y1})`);
  }
  if (components !== 1) {
    throw new UnsupportedJ2kError(
      "multiple components",
      `SIZ declares ${components} components; GRIB 5.40 fields are a single grayscale plane`,
    );
  }
  if (xt === 0 || yt === 0 || xt0 > x0 || yt0 > y0) {
    throw new J2kFormatError(`SIZ tile grid (${xt}x${yt} at ${xt0},${yt0}) is invalid`);
  }
  const tilesX = Math.ceil((x1 - xt0) / xt);
  const tilesY = Math.ceil((y1 - yt0) / yt);
  if (tilesX !== 1 || tilesY !== 1) {
    throw new UnsupportedJ2kError(
      "multiple tiles",
      `SIZ partitions the image into ${tilesX}x${tilesY} tiles; this decoder handles one tile covering the grid`,
    );
  }
  const ssiz = u8(cs, at + 40);
  const bitsPerSample = (ssiz & 0x7f) + 1;
  const isSigned = (ssiz & 0x80) !== 0;
  if (bitsPerSample > 28) {
    // Tier-1 carries magnitudes doubled, so subband Mb (exponent + guard
    // bits - 1) must stay within the int32 carrier; 28 bits is the ceiling
    // that guarantees it.
    throw new UnsupportedJ2kError(
      "deep samples",
      `SIZ declares ${bitsPerSample}-bit samples; the int32 coefficient carrier supports at most 28`,
    );
  }
  const xr = u8(cs, at + 41);
  const yr = u8(cs, at + 42);
  if (xr !== 1 || yr !== 1) {
    throw new UnsupportedJ2kError(
      "component subsampling",
      `SIZ declares XRsiz=${xr} YRsiz=${yr}; the single GRIB component is never subsampled`,
    );
  }
  return { x0, y0, x1, y1, bitsPerSample, isSigned };
}

interface CodInfo {
  progressionOrder: number;
  decompositionLevels: number;
  codeblockWidth: number;
  codeblockHeight: number;
}

function parseCod(cs: Uint8Array, at: number): CodInfo {
  const scod = u8(cs, at + 4);
  if ((scod & 0x01) !== 0) {
    throw new UnsupportedJ2kError(
      "precinct partitions",
      "COD declares explicit precinct sizes; the feeds use default whole-tile precincts",
    );
  }
  if ((scod & 0x02) !== 0 || (scod & 0x04) !== 0) {
    throw new UnsupportedJ2kError(
      "SOP/EPH markers",
      `COD requests ${(scod & 0x02) !== 0 ? "SOP" : "EPH"} marker segments; the feeds never emit them`,
    );
  }
  const progressionOrder = u8(cs, at + 5);
  if (progressionOrder > 4) {
    throw new J2kFormatError(`COD progression order ${progressionOrder} is not a T.800 value`);
  }
  const layers = u16(cs, at + 6);
  if (layers !== 1) {
    throw new UnsupportedJ2kError(
      "multiple quality layers",
      `COD declares ${layers} layers; lossless GRIB fields carry exactly one`,
    );
  }
  const mct = u8(cs, at + 8);
  if (mct !== 0) {
    throw new UnsupportedJ2kError(
      "multiple component transformation",
      `COD requests component transform ${mct} on a single-component image`,
    );
  }
  const decompositionLevels = u8(cs, at + 9);
  if (decompositionLevels > 32) {
    throw new J2kFormatError(`COD decomposition levels ${decompositionLevels} exceeds T.800's 32`);
  }
  const cbwExp = (u8(cs, at + 10) & 0x0f) + 2;
  const cbhExp = (u8(cs, at + 11) & 0x0f) + 2;
  if (cbwExp + cbhExp > 12 || cbwExp > 10 || cbhExp > 10) {
    throw new J2kFormatError(
      `COD codeblock size 2^${cbwExp} x 2^${cbhExp} violates T.800's limits`,
    );
  }
  const style = u8(cs, at + 12);
  if (style !== 0) {
    const styles: Array<[number, string]> = [
      [0x01, "selective arithmetic coding bypass"],
      [0x02, "context probability reset"],
      [0x04, "termination on each coding pass"],
      [0x08, "vertically causal context"],
      [0x10, "predictable termination"],
      [0x20, "segmentation symbols"],
    ];
    const named = styles.filter(([bit]) => (style & bit) !== 0).map(([, name]) => name);
    throw new UnsupportedJ2kError(
      "codeblock coding style",
      `COD requests ${named.join(", ") || `style 0x${style.toString(16)}`}; the feeds use the default style`,
    );
  }
  const wavelet = u8(cs, at + 13);
  if (wavelet !== 1) {
    throw new UnsupportedJ2kError(
      "9/7 irrational wavelet",
      `COD selects transform ${wavelet}; lossless GRIB fields use the reversible 5/3 (1)`,
    );
  }
  return {
    progressionOrder,
    decompositionLevels,
    codeblockWidth: 1 << cbwExp,
    codeblockHeight: 1 << cbhExp,
  };
}

interface QcdInfo {
  guardBits: number;
  exponents: number[];
}

function parseQuantization(
  cs: Uint8Array,
  sAt: number,
  end: number,
  levels: number,
  label: string,
): QcdInfo {
  const s = u8(cs, sAt);
  const style = s & 0x1f;
  if (style !== 0) {
    throw new UnsupportedJ2kError(
      "quantization",
      `${label} declares quantization style ${style}; the reversible 5/3 path is style 0 (none)`,
    );
  }
  const guardBits = s >> 5;
  const expected = 3 * levels + 1;
  const available = end - (sAt + 1);
  if (available !== expected) {
    throw new J2kFormatError(
      `${label} carries ${available} subband exponents; ${levels} decomposition levels need ${expected}`,
    );
  }
  const exponents: number[] = [];
  for (let i = 0; i < expected; i++) {
    exponents.push(u8(cs, sAt + 1 + i) >> 3);
  }
  return { guardBits, exponents };
}

function parseQcd(cs: Uint8Array, at: number, length: number, levels: number): QcdInfo {
  return parseQuantization(cs, at + 4, at + 2 + length, levels, "QCD");
}

function parseQcc(cs: Uint8Array, at: number, length: number, levels: number): QcdInfo {
  const component = u8(cs, at + 4);
  if (component !== 0) {
    throw new J2kFormatError(`QCC names component ${component} of a single-component image`);
  }
  return parseQuantization(cs, at + 5, at + 2 + length, levels, "QCC");
}

/**
 * Parses the main and tile-part headers of a raw JPEG 2000 codestream and
 * locates the single tile-part's packet bitstream; throws
 * UnsupportedJ2kError or J2kFormatError.
 */
export function parseCodestream(cs: Uint8Array): CodestreamHeader {
  if (cs.length < 4 || u16(cs, 0) !== SOC) {
    throw new J2kFormatError("does not start with an SOC marker (not a raw codestream)");
  }
  if (u16(cs, 2) !== SIZ) {
    throw new J2kFormatError("SIZ does not directly follow SOC");
  }

  let siz: SizInfo | undefined;
  let cod: CodInfo | undefined;
  let qcd: QcdInfo | undefined;
  let p = 2;

  let sotStart = -1;
  while (p < cs.length) {
    const marker = u16(cs, p);
    if (marker === SOT) {
      sotStart = p;
      break;
    }
    const length = u16(cs, p + 2);
    if (length < 2 || p + 2 + length > cs.length) {
      throw new J2kFormatError(`marker ${markerName(marker)} segment overruns the codestream`);
    }
    if (marker === SIZ) {
      siz = parseSiz(cs, p, length);
    } else if (marker === COD) {
      cod = parseCod(cs, p);
    } else if (marker === QCD) {
      if (cod === undefined) throw new J2kFormatError("QCD appears before COD");
      qcd = parseQcd(cs, p, length, cod.decompositionLevels);
    } else if (marker === COC || marker === QCC) {
      throw new UnsupportedJ2kError(
        "per-component coding overrides",
        `${marker === COC ? "COC" : "QCC"} on a single-component image; the feeds never override COD/QCD`,
      );
    } else if (marker === RGN) {
      throw new UnsupportedJ2kError("ROI shift", "RGN marker present; the feeds carry no ROI");
    } else if (marker === POC) {
      throw new UnsupportedJ2kError(
        "progression order changes",
        "POC marker present; with one layer/component/precinct there is nothing to change",
      );
    } else if (marker === PPM) {
      throw packedHeadersError("PPM");
    } else if (!SKIPPED_MAIN.has(marker)) {
      throw new UnsupportedJ2kError(
        "unrecognized marker",
        `main header carries marker ${markerName(marker)}, which this decoder does not know how to honor`,
      );
    }
    p += 2 + length;
  }
  if (sotStart === -1) throw new J2kFormatError("no SOT marker in the main header");
  if (siz === undefined) throw new J2kFormatError("no SIZ marker");
  if (cod === undefined) throw new J2kFormatError("no COD marker");
  if (qcd === undefined) throw new J2kFormatError("no QCD marker");

  const lsot = u16(cs, sotStart + 2);
  if (lsot !== 10) throw new J2kFormatError(`SOT length ${lsot}, expected 10`);
  const isot = u16(cs, sotStart + 4);
  const psot = u32(cs, sotStart + 6);
  const tpsot = u8(cs, sotStart + 10);
  const tnsot = u8(cs, sotStart + 11);
  if (isot !== 0) throw new J2kFormatError(`SOT names tile ${isot} in a one-tile codestream`);
  if (tpsot !== 0 || tnsot > 1) {
    throw new UnsupportedJ2kError(
      "multiple tile-parts",
      `SOT declares tile-part ${tpsot} of ${tnsot}; the feeds write exactly one`,
    );
  }
  const tilePartEnd = psot === 0 ? cs.length - 2 : sotStart + psot;
  if (tilePartEnd > cs.length - 2) {
    throw new J2kFormatError(`Psot ${psot} runs past the codestream end`);
  }

  p = sotStart + 12;
  let bodyStart = -1;
  let tileQcc: QcdInfo | undefined;
  while (p < tilePartEnd) {
    const marker = u16(cs, p);
    if (marker === SOD) {
      bodyStart = p + 2;
      break;
    }
    const length = u16(cs, p + 2);
    if (length < 2 || p + 2 + length > tilePartEnd) {
      throw new J2kFormatError(`tile-part marker ${markerName(marker)} overruns the tile-part`);
    }
    if (marker === PPT) {
      throw packedHeadersError("PPT");
    } else if (marker === QCC) {
      tileQcc = parseQcc(cs, p, length, cod.decompositionLevels);
    } else if (marker === COC || marker === RGN || marker === POC) {
      throw new UnsupportedJ2kError(
        "tile-part coding overrides",
        `marker ${markerName(marker)} in the tile-part header; the feeds keep coding style in the main header`,
      );
    } else if (!SKIPPED_TILE.has(marker)) {
      throw new UnsupportedJ2kError(
        "unrecognized marker",
        `tile-part header carries marker ${markerName(marker)}`,
      );
    }
    p += 2 + length;
  }
  if (bodyStart === -1) throw new J2kFormatError("no SOD marker in the tile-part");

  const trailer = u16(cs, tilePartEnd);
  if (trailer === SOT) {
    throw new UnsupportedJ2kError(
      "multiple tile-parts",
      "a second SOT follows the first tile-part",
    );
  }
  if (trailer !== EOC) {
    throw new J2kFormatError(
      `expected EOC after the tile-part, found ${markerName(trailer)} at offset ${tilePartEnd}`,
    );
  }

  return {
    x0: siz.x0,
    y0: siz.y0,
    x1: siz.x1,
    y1: siz.y1,
    width: siz.x1 - siz.x0,
    height: siz.y1 - siz.y0,
    bitsPerSample: siz.bitsPerSample,
    isSigned: siz.isSigned,
    decompositionLevels: cod.decompositionLevels,
    codeblockWidth: cod.codeblockWidth,
    codeblockHeight: cod.codeblockHeight,
    progressionOrder: cod.progressionOrder,
    guardBits: (tileQcc ?? qcd).guardBits,
    exponents: (tileQcc ?? qcd).exponents,
    bodyStart,
    bodyEnd: tilePartEnd,
  };
}

function packedHeadersError(marker: string): UnsupportedJ2kError {
  return new UnsupportedJ2kError(
    "packed packet headers",
    `${marker} marker present; the feeds write packet headers in-stream`,
  );
}
