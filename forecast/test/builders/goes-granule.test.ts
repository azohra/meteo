import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTS,
  sampleSites,
  type GoesSite,
  type Product,
  type SiteIndices,
} from "../../src/builders/goes.js";
import { hasHdf5Signature, openGranule, type Granule } from "../../src/builders/granule.js";

// Mirrors netcdf4_reference.PIXELS — asserted against the reference's
// per-pixel DQF report below, so the two tables cannot drift apart
// silently.
const PIXELS = {
  good: [2, 2], // valid retrieval, DQF 0
  medium: [3, 3], // valid retrieval, DQF 1
  low: [4, 4], // valid retrieval, DQF 2 — AOD rejects
  worst: [5, 5], // valid retrieval, DQF 3 — AOD rejects
  night: [0, 0], // _FillValue with DQF 0 — the DSR trap
  invalid: [0, 1], // outside valid_range but not fill
} as const;

const SITES: GoesSite[] = Object.keys(PIXELS).map((slug) => ({
  slug,
  name: slug,
  latitude: 0,
  longitude: 0,
}));

const INDICES: SiteIndices = Object.fromEntries(
  Object.entries(PIXELS).map(([slug, index]) => [slug, index as readonly [number, number]]),
);

interface ProbePixel {
  masked: boolean;
  value: number | null;
  dqfMasked: boolean;
  dqf: number;
}

interface Reference {
  pixels: Record<keyof typeof PIXELS, ProbePixel>;
  x: number[];
  xDtype: string;
}

const FIXTURES = new URL("../fixtures/goes/", import.meta.url);
const GRANULE_BYTES = new Uint8Array(readFileSync(new URL("synthetic-abi.nc", FIXTURES)));
const REFERENCE = JSON.parse(
  readFileSync(new URL("probe-expectations.json", FIXTURES), "utf-8"),
) as Reference;

async function withGranule<T>(work: (granule: Granule) => T | Promise<T>): Promise<T> {
  const granule = await openGranule(GRANULE_BYTES);
  try {
    return await work(granule);
  } finally {
    granule.close();
  }
}

/* The gate applied to netCDF4's own per-pixel reading — the independently
   derived answer the h5wasm path must reproduce. */
function expectedSamples(maxQuality: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(REFERENCE.pixels)
      .filter(([, pixel]) => !pixel.masked && !pixel.dqfMasked && pixel.dqf <= maxQuality)
      .map(([slug, pixel]) => [slug, pixel.value!]),
  );
}

describe("the probe fixture", () => {
  it("mirrors the reference's pixel table, so the two cannot drift apart", () => {
    expect(Object.keys(REFERENCE.pixels).sort()).toEqual(Object.keys(PIXELS).sort());
    // The DQF ramp the gate tests ride on, as the reference measured it.
    expect(REFERENCE.pixels.good.dqf).toBe(0);
    expect(REFERENCE.pixels.medium.dqf).toBe(1);
    expect(REFERENCE.pixels.low.dqf).toBe(2);
    expect(REFERENCE.pixels.worst.dqf).toBe(3);
    // The live DSR trap, reproduced synthetically: fill value with DQF 0.
    expect(REFERENCE.pixels.night.masked).toBe(true);
    expect(REFERENCE.pixels.night.dqf).toBe(0);
    expect(REFERENCE.pixels.invalid.masked).toBe(true);
  });

  it("packs float32 — the premise the fround emulation stands on", () => {
    expect(REFERENCE.xDtype).toBe("float32");
  });
});

describe("bit identity with netCDF4", () => {
  it("whole-file extraction matches netCDF4's mask-and-scale bit for bit (AOD gate)", async () => {
    const product = PRODUCTS["goes18-aod"];
    const expected = expectedSamples(product.maxQuality);

    const { samples } = await withGranule((granule) =>
      sampleSites(granule, product, SITES, INDICES),
    );

    // Sensitivity first: the gate really gated — retrievals at DQF 0 and
    // 1 pass, DQF 2-3 and both masked pixels are absences.
    expect(Object.keys(expected).sort()).toEqual(["good", "medium"]);
    expect(Object.keys(samples).sort()).toEqual(Object.keys(expected).sort());
    for (const [slug, value] of Object.entries(expected)) {
      // toBe is Object.is — bit identity for every non-NaN double.
      expect(samples[slug]).toBe(value);
    }
  });

  it("the scaled coordinate axis matches netCDF4's to the bit", async () => {
    const values = await withGranule((granule) => granule.variable("x").values());
    expect(Array.from(values)).toEqual(REFERENCE.x);
    for (let index = 0; index < REFERENCE.x.length; index += 1) {
      expect(values[index]).toBe(REFERENCE.x[index]);
    }
  });

  it("the DSR quality gate stays exact zero", async () => {
    // The DSR product's gate (unmasked AND DQF == 0) over the same
    // granule variable: only the DQF-0 pixel passes, and the
    // fill-with-DQF-0 night pixel stays an absence.
    const product: Product = {
      ...PRODUCTS["goes18-dsr"],
      variable: "AOD",
      valueKey: "downwardShortwaveWm2",
    };
    const expected = expectedSamples(product.maxQuality);

    const { samples } = await withGranule((granule) =>
      sampleSites(granule, product, SITES, INDICES),
    );

    expect(Object.keys(expected)).toEqual(["good"]);
    expect(samples).toEqual(expected);
  });
});

describe("the validity gate's raw pixels", () => {
  it("night is fill with DQF 0 — masked value, quality proves nothing", async () => {
    await withGranule((granule) => {
      expect(granule.variable("AOD").pixel(0, 0)).toBeNull();
      expect(granule.variable("DQF").pixel(0, 0)).toBe(0);
    });
  });

  it("a value outside valid_range is masked even though it is not fill", async () => {
    await withGranule((granule) => {
      expect(granule.variable("AOD").pixel(0, 1)).toBeNull();
      expect(granule.variable("DQF").pixel(0, 1)).toBe(0);
    });
  });
});

describe("the signature gate", () => {
  it("recognizes the HDF5 magic", () => {
    expect(hasHdf5Signature(GRANULE_BYTES)).toBe(true);
    expect(hasHdf5Signature(new TextEncoder().encode("<Error>AccessDenied</Error>"))).toBe(false);
    expect(hasHdf5Signature(new Uint8Array(0))).toBe(false);
  });

  it("routes transport garbage to a cause-naming error before h5wasm", async () => {
    await expect(openGranule(new TextEncoder().encode("not a granule"))).rejects.toThrow(
      /HDF5 signature/,
    );
  });

  it("bytes with the signature but no HDF5 structure fail loudly too", async () => {
    // A truncated download: the magic is there, the file is not. The HDF5 C
    // library narrates the expected failure through console.error; silence
    // what can be silenced (one stack escapes through a channel bound at
    // WASM init).
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(openGranule(GRANULE_BYTES.subarray(0, 512))).rejects.toThrow(
        /do not parse as HDF5/,
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("granule surface errors", () => {
  it("a missing variable names itself", async () => {
    await withGranule((granule) => {
      expect(() => granule.variable("nope")).toThrow(/no variable nope/);
    });
  });

  it("a missing attribute names variable and attribute", async () => {
    await withGranule((granule) => {
      expect(() => granule.variable("AOD").attribute("nope")).toThrow(/AOD has no attribute nope/);
    });
  });
});
