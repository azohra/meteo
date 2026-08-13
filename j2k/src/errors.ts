/** A valid-but-out-of-subset codestream: names the unsupported feature. */
export class UnsupportedJ2kError extends Error {
  readonly feature: string;

  constructor(feature: string, detail: string) {
    super(`JPEG 2000 feature not supported by @azohra/meteo.j2k: ${feature} — ${detail}`);
    this.name = "UnsupportedJ2kError";
    this.feature = feature;
  }
}

/** Bytes that are not a well-formed codestream of the supported subset. */
export class J2kFormatError extends Error {
  constructor(detail: string) {
    super(`Malformed JPEG 2000 codestream: ${detail}`);
    this.name = "J2kFormatError";
  }
}
