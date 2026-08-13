import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import h5wasm from "h5wasm/node";
import type { Attribute, Dataset } from "h5wasm/node";

/** The HDF5 file signature, at offset 0 on every GOES granule. */
export const HDF5_SIGNATURE = Uint8Array.of(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a);

export function hasHdf5Signature(payload: Uint8Array): boolean {
  return (
    payload.length >= HDF5_SIGNATURE.length &&
    HDF5_SIGNATURE.every((byte, index) => payload[index] === byte)
  );
}

export interface GranuleVariable {
  attribute(name: string): number;
  values(): Float64Array;
  pixel(row: number, column: number): number | null;
}

export interface GranuleReader {
  variable(name: string): GranuleVariable;
}

let granuleSequence = 0;

// h5wasm's /node build is compiled with NODERAWFS — an in-memory
// FS.writeFile hits the real OS root and fails EROFS — so the bytes go
// through a per-granule temp file the reader owns and removes on close.
export async function openGranule(payload: Uint8Array): Promise<Granule> {
  if (!hasHdf5Signature(payload)) {
    throw new Error(
      "granule bytes do not start with the HDF5 signature — the transport " +
        "served something that is not an HDF5 file",
    );
  }
  await h5wasm.ready;
  const directory = mkdtempSync(join(tmpdir(), `goes-granule-${granuleSequence++}-`));
  const path = join(directory, "granule.nc");
  writeFileSync(path, payload);
  let file: InstanceType<typeof h5wasm.File> | null = null;
  try {
    file = new h5wasm.File(path, "r");
    if (file.file_id <= 0n) {
      throw new Error("h5wasm could not open the granule");
    }
    return new Granule(file, directory);
  } catch (error) {
    if (file !== null && file.file_id > 0n) {
      file.close();
    }
    rmSync(directory, { recursive: true, force: true });
    throw new Error(
      "granule bytes carry the HDF5 signature but do not parse as HDF5" +
        ` (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

export class Granule implements GranuleReader {
  private readonly file: InstanceType<typeof h5wasm.File>;
  private readonly directory: string;

  constructor(file: InstanceType<typeof h5wasm.File>, directory: string) {
    this.file = file;
    this.directory = directory;
  }

  variable(name: string): GranuleVariable {
    const entity = this.file.get(name);
    if (!(entity instanceof h5wasm.Dataset)) {
      throw new Error(`granule has no variable ${name}`);
    }
    return new H5Variable(entity, name);
  }

  close(): void {
    this.file.close();
    rmSync(this.directory, { recursive: true, force: true });
  }
}

interface Packing {
  fillValue: number | null;
  validRange: readonly [number, number] | null;
  scale: PackedFactor | null;
  offset: PackedFactor | null;
}

interface PackedFactor {
  value: number;
  /** A float32 attribute's arithmetic step must round through fround. */
  float32: boolean;
}

class H5Variable implements GranuleVariable {
  private readonly dataset: Dataset;
  private readonly name: string;
  private readonly attributes: Record<string, Attribute>;
  private readonly packing: Packing;

  constructor(dataset: Dataset, name: string) {
    this.dataset = dataset;
    this.name = name;
    this.attributes = dataset.attrs;
    this.packing = {
      fillValue: this.scalarOrNull("_FillValue"),
      validRange: this.rangeOrNull("valid_range"),
      scale: this.factorOrNull("scale_factor"),
      offset: this.factorOrNull("add_offset"),
    };
  }

  attribute(name: string): number {
    const attribute = this.attributes[name];
    if (attribute === undefined) {
      throw new Error(`granule variable ${this.name} has no attribute ${name}`);
    }
    return attributeScalar(attribute, `${this.name}.${name}`);
  }

  values(): Float64Array {
    const raw = this.dataset.value;
    if (raw === null || typeof raw === "string" || !isNumericArray(raw)) {
      throw new Error(`granule variable ${this.name} is not a numeric array`);
    }
    const scaled = new Float64Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      const value = this.maskAndScale(Number(raw[index]));
      scaled[index] = value === null ? Number.NaN : value;
    }
    return scaled;
  }

  pixel(row: number, column: number): number | null {
    const slice = this.dataset.slice([
      [row, row + 1],
      [column, column + 1],
    ]);
    if (slice === null || typeof slice === "string" || !isNumericArray(slice)) {
      throw new Error(`granule variable ${this.name} is not a numeric 2-D array`);
    }
    return this.maskAndScale(Number(slice[0]));
  }

  // netCDF4's auto mask-and-scale: _FillValue and valid_range on the raw
  // integer, then data*scale_factor + add_offset in the attributes' own
  // dtypes — each float32 step rounds through fround, which is exact.
  private maskAndScale(raw: number): number | null {
    const { fillValue, validRange, scale, offset } = this.packing;
    if (fillValue !== null && raw === fillValue) {
      return null;
    }
    if (validRange !== null && (raw < validRange[0] || raw > validRange[1])) {
      return null;
    }
    if (scale !== null) {
      const scaled = scale.float32 ? Math.fround(raw * scale.value) : raw * scale.value;
      if (offset === null) {
        return scaled;
      }
      return scale.float32 && offset.float32
        ? Math.fround(scaled + offset.value)
        : scaled + offset.value;
    }
    if (offset !== null) {
      return offset.float32 ? Math.fround(raw + offset.value) : raw + offset.value;
    }
    return raw;
  }

  private scalarOrNull(name: string): number | null {
    const attribute = this.attributes[name];
    return attribute === undefined ? null : attributeScalar(attribute, `${this.name}.${name}`);
  }

  private rangeOrNull(name: string): readonly [number, number] | null {
    const attribute = this.attributes[name];
    if (attribute === undefined) {
      return null;
    }
    const values = attributeNumbers(attribute, `${this.name}.${name}`);
    if (values.length !== 2) {
      throw new Error(`granule attribute ${this.name}.${name} is not a two-value range`);
    }
    return [values[0], values[1]];
  }

  private factorOrNull(name: string): PackedFactor | null {
    const attribute = this.attributes[name];
    if (attribute === undefined) {
      return null;
    }
    return {
      value: attributeScalar(attribute, `${this.name}.${name}`),
      // H5T_FLOAT is type 1; a 4-byte float attribute is float32.
      float32: attribute.metadata.type === 1 && attribute.metadata.size === 4,
    };
  }
}

// netCDF stores scalar attributes as 1-element arrays; h5wasm hands back a
// typed array for those and a bare number for true scalars.
function attributeScalar(attribute: Attribute, label: string): number {
  const values = attributeNumbers(attribute, label);
  if (values.length !== 1) {
    throw new Error(`granule attribute ${label} is not single-valued`);
  }
  return values[0];
}

function attributeNumbers(attribute: Attribute, label: string): number[] {
  const value = attribute.value;
  if (typeof value === "number") {
    return [value];
  }
  if (typeof value === "bigint") {
    return [Number(value)];
  }
  if (value !== null && isNumericArray(value)) {
    const values: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      values.push(Number(value[index]));
    }
    return values;
  }
  throw new Error(`granule attribute ${label} is not numeric`);
}

function isNumericArray(value: unknown): value is ArrayLike<number | bigint> {
  return (
    ArrayBuffer.isView(value) ||
    (Array.isArray(value) && value.every((element) => typeof element === "number"))
  );
}
