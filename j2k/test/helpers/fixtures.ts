import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixturesDir = fileURLToPath(new URL("../../../grib/test/fixtures/", import.meta.url));

export function fixtureCodestream(name: string): Uint8Array {
  return firstJ2kCodestream(new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`)));
}

const SECTION0_LENGTH = 16;
const SECTION_HEADER_LENGTH = 5;

/** The first section 7 body of a GRIB2 message: the raw JPEG 2000
 * codestream a DRT 5.40 field carries. */
export function firstJ2kCodestream(message: Uint8Array): Uint8Array {
  if (String.fromCharCode(...message.subarray(0, 4)) !== "GRIB") {
    throw new Error("not a GRIB2 message");
  }
  let offset = SECTION0_LENGTH;
  while (offset + SECTION_HEADER_LENGTH <= message.length) {
    const length =
      message[offset]! * 0x1000000 +
      ((message[offset + 1]! << 16) | (message[offset + 2]! << 8) | message[offset + 3]!);
    if (message[offset + 4] === 7) {
      return message.subarray(offset + SECTION_HEADER_LENGTH, offset + length);
    }
    offset += length;
  }
  throw new Error("no section 7 in the message");
}
