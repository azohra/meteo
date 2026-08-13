import { u8, u16, u32, u64 } from "./bytes.js";

const GRIB_MAGIC = 0x47524942;
const TRAILER = 0x37373737;

/**
 * Splits a buffer of concatenated GRIB2 messages into single messages,
 * throwing on misaligned or truncated bytes.
 */
export function splitMessages(buffer: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 16 > buffer.length || u32(buffer, offset) !== GRIB_MAGIC) {
      throw new Error(`GRIB stream is misaligned at byte ${offset}`);
    }
    const length = u64(buffer, offset + 8);
    const end = offset + length;
    if (length < 20 || end > buffer.length || u32(buffer, end - 4) !== TRAILER) {
      throw new Error(`GRIB message at byte ${offset} is truncated`);
    }
    messages.push(buffer.subarray(offset, end));
    offset = end;
  }
  return messages;
}

/** Section 1 as raw, unconverted code-table values. */
export interface Identification {
  centre: number;
  subCentre: number;
  tablesVersion: number;
  localTablesVersion: number;
  significanceOfReferenceTime: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  productionStatus: number;
  typeOfProcessedData: number;
}

/**
 * One decodable field: the sections in force at one section 7. `section6`
 * is the bitmap section that applies to this field, with indicator 254
 * resolved to its defining indicator-0 section.
 */
export interface GribField {
  discipline: number;
  editionNumber: number;
  identification: Identification;
  /** Raw section bytes, each including its 5-octet section header. */
  section1: Uint8Array;
  section2: Uint8Array | undefined;
  section3: Uint8Array;
  section4: Uint8Array;
  section5: Uint8Array;
  section6: Uint8Array | undefined;
  section7: Uint8Array;
}

function parseIdentification(section1: Uint8Array): Identification {
  if (section1.length < 21) {
    throw new Error(`GRIB section 1 is ${section1.length} bytes, expected at least 21`);
  }
  return {
    centre: u16(section1, 5),
    subCentre: u16(section1, 7),
    tablesVersion: u8(section1, 9),
    localTablesVersion: u8(section1, 10),
    significanceOfReferenceTime: u8(section1, 11),
    year: u16(section1, 12),
    month: u8(section1, 14),
    day: u8(section1, 15),
    hour: u8(section1, 16),
    minute: u8(section1, 17),
    second: u8(section1, 18),
    productionStatus: u8(section1, 19),
    typeOfProcessedData: u8(section1, 20),
  };
}

/**
 * Walks sections 0-8 of ONE GRIB2 message and returns every field —
 * one per section 7 occurrence — with its inherited sections.
 */
export function parseFields(message: Uint8Array): GribField[] {
  if (message.length < 20 || u32(message, 0) !== GRIB_MAGIC) {
    throw new Error("GRIB stream is misaligned at byte 0");
  }
  const edition = u8(message, 7);
  if (edition !== 2) {
    throw new Error(`GRIB edition ${edition} is not supported (GRIB2 only)`);
  }
  const totalLength = u64(message, 8);
  if (totalLength !== message.length) {
    throw new Error(
      `GRIB message declares ${totalLength} bytes but ${message.length} were provided`,
    );
  }
  const discipline = u8(message, 6);

  const fields: GribField[] = [];
  const current = new Map<number, Uint8Array>();
  let lastDefinedBitmap: Uint8Array | undefined;
  let bitmapForNextField: Uint8Array | undefined;

  let offset = 16;
  while (true) {
    if (offset + 4 > message.length) {
      throw new Error(`GRIB message ends without a 7777 trailer (at byte ${offset})`);
    }
    if (u32(message, offset) === TRAILER) {
      if (offset + 4 !== message.length) {
        throw new Error(`GRIB message has ${message.length - offset - 4} bytes after 7777`);
      }
      break;
    }
    if (offset + 5 > message.length) {
      throw new Error(`GRIB section header at byte ${offset} is truncated`);
    }
    const length = u32(message, offset);
    const number = u8(message, offset + 4);
    if (number < 1 || number > 7) {
      throw new Error(`GRIB section number ${number} at byte ${offset} is invalid`);
    }
    if (length < 5 || offset + length > message.length) {
      throw new Error(`GRIB section ${number} at byte ${offset} is truncated`);
    }
    const section = message.subarray(offset, offset + length);

    if (number === 6) {
      const indicator = u8(section, 5);
      if (indicator === 0) {
        lastDefinedBitmap = section;
        bitmapForNextField = section;
      } else if (indicator === 254) {
        if (lastDefinedBitmap === undefined) {
          throw new Error(
            "GRIB bitmap indicator 254 references a previously defined bitmap, but none precedes it",
          );
        }
        bitmapForNextField = lastDefinedBitmap;
      } else if (indicator === 255) {
        bitmapForNextField = undefined;
      } else {
        throw new Error(`GRIB bitmap indicator ${indicator} is not supported (0, 254, 255)`);
      }
      current.set(6, section);
    } else {
      current.set(number, section);
    }

    if (number === 7) {
      const section1 = current.get(1);
      const section3 = current.get(3);
      const section4 = current.get(4);
      const section5 = current.get(5);
      if (!section1 || !section3 || !section4 || !section5) {
        throw new Error("GRIB field reached section 7 without sections 1, 3, 4, and 5");
      }
      fields.push({
        discipline,
        editionNumber: edition,
        identification: parseIdentification(section1),
        section1,
        section2: current.get(2),
        section3,
        section4,
        section5,
        section6: bitmapForNextField,
        section7: section,
      });
    }
    offset += length;
  }

  if (fields.length === 0) {
    throw new Error("GRIB message contains no data section");
  }
  return fields;
}
