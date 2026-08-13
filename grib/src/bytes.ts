export function u8(bytes: Uint8Array, offset: number): number {
  return bytes[offset]!;
}

export function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

export function u32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

export function u64(bytes: Uint8Array, offset: number): number {
  const high = u32(bytes, offset);
  const low = u32(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`64-bit value at byte ${offset} exceeds 2^53 - 1`);
  }
  return value;
}

// GRIB2 signed fields are sign-and-magnitude (top bit is a sign), not
// two's complement.
export function i8sm(bytes: Uint8Array, offset: number): number {
  const raw = bytes[offset]!;
  return raw & 0x80 ? -(raw & 0x7f) : raw;
}

export function i16sm(bytes: Uint8Array, offset: number): number {
  const raw = u16(bytes, offset);
  return raw & 0x8000 ? -(raw & 0x7fff) : raw;
}

export function i32sm(bytes: Uint8Array, offset: number): number {
  const raw = u32(bytes, offset);
  return raw & 0x80000000 ? -(raw & 0x7fffffff) : raw;
}

export function float32be(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getFloat32(offset, false);
}

/** All bits set in an n-bit unsigned field — GRIB2's "value is missing"
 * encoding for optional numeric octets. */
export function allOnes(bits: number): number {
  return 2 ** bits - 1;
}

export class BitReader {
  private readonly bytes: Uint8Array;
  bitPosition: number;

  constructor(bytes: Uint8Array, startBit = 0) {
    this.bytes = bytes;
    this.bitPosition = startBit;
  }

  read(bits: number): number {
    if (bits === 0) return 0;
    if (bits < 0 || bits > 32) {
      throw new Error(`BitReader supports 0-32 bit reads, got ${bits}`);
    }
    if (this.bitPosition + bits > this.bytes.length * 8) {
      throw new Error(
        `bit read past end of buffer (at bit ${this.bitPosition}, want ${bits}, have ${this.bytes.length * 8})`,
      );
    }
    let result = 0;
    let remaining = bits;
    while (remaining > 0) {
      const byte = this.bytes[this.bitPosition >> 3]!;
      const available = 8 - (this.bitPosition & 7);
      const take = Math.min(available, remaining);
      const chunk = (byte >> (available - take)) & ((1 << take) - 1);
      result = result * 2 ** take + chunk;
      this.bitPosition += take;
      remaining -= take;
    }
    return result;
  }

  /** One sign bit, then `bits - 1` of magnitude. */
  readSigned(bits: number): number {
    if (bits === 0) return 0;
    const negative = this.read(1) === 1;
    const magnitude = this.read(bits - 1);
    return negative ? -magnitude : magnitude;
  }
}
