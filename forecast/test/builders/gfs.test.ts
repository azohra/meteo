import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MissingRecordError, findRecord, parseIdx, type IdxRecord } from "@azohra/meteo.grib";
import {
  GFS,
  buildNoaa,
  buildProfiles,
  deaveraged,
  differenced,
  windowStart,
  type NoaaWire,
} from "../../src/builders/noaa.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import { dewPointC, dewPointDepressionC } from "@azohra/meteo.briefing/derive";
import type { GridPointValue, SampleSite } from "../../src/providers/noaa.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { splitMembers } from "../../src/history.js";
import { stubFetch, useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

// The builders derive depression through briefing's Magnus pair.
const dewPointDepression = (temperatureC: number, rhPercent: number): number =>
  dewPointDepressionC(temperatureC, dewPointC(temperatureC, rhPercent));

const fixtureIdx = (name: string): IdxRecord[] =>
  parseIdx(
    readFileSync(
      fileURLToPath(new URL(`../../../grib/test/fixtures-idx/${name}`, import.meta.url)),
      "utf-8",
    ),
  );

describe("the 6-hour growing windows", () => {
  it.each([
    [3, 0],
    [6, 0],
    [21, 18],
    [24, 18],
    [123, 120],
    [126, 120],
    [384, 378],
  ])("the window holding f%03d starts at %d", (forecastHour, start) => {
    expect(windowStart(forecastHour)).toBe(start);
  });

  it("a constant flux survives de-averaging", () => {
    // A(21) and A(24) both average a constant 130 W/m²; the (21, 24] mean is 130.
    expect(deaveraged(130.0, 130.0)).toBe(130.0);
  });

  it("de-averaging recovers the second half of the window", () => {
    // 100 W/m² over (18, 21], 200 W/m² over (21, 24]: the 6 h average is 150.
    expect(deaveraged(150.0, 100.0)).toBe(200.0);
  });

  it("differencing recovers the second half of an accumulation", () => {
    // 2 mm fell by f021, 5 mm by f024: 3 mm fell over (21, 24].
    expect(differenced(5.0, 2.0)).toBe(3.0);
  });
});

describe("the .idx fixture proofs", () => {
  const f021 = () => fixtureIdx("gfs.t12z.pgrb2.0p25.f021.excerpt.idx");
  const f024 = () => fixtureIdx("gfs.t12z.pgrb2.0p25.f024.excerpt.idx");

  it("windowed records exist under their exact forecast names", () => {
    for (const [records, window] of [
      [f021(), "18-21"],
      [f024(), "18-24"],
    ] as const) {
      findRecord(records, "LHTFL", "surface", `${window} hour ave fcst`);
      findRecord(records, "SHTFL", "surface", `${window} hour ave fcst`);
      findRecord(records, "APCP", "surface", `${window} hour acc fcst`);
    }
  });

  it("science records resolve to the instantaneous flavour", () => {
    // GFS publishes the L/M/H cloud layers twice per step: instantaneous
    // ("24 hour fcst") and a 6-h-bucket average ("18-24 hour ave fcst").
    // The builder's default forecast token must land on the instant record.
    const records = f024();

    for (const [fieldName, [variable, level]] of Object.entries(GFS.optionalSurfaceFields)) {
      const record = findRecord(records, variable, level, "24 hour fcst");
      expect(record.forecast, fieldName).toBe("24 hour fcst");
    }
    // The average flavour exists right beside it — proof the disambiguation
    // is doing real work, not matching the only record there is.
    findRecord(records, "LCDC", "low cloud layer", "18-24 hour ave fcst");
  });

  it("GFS carries a cloud profile at every curated level", () => {
    const records = f024();
    for (const pressureHpa of GFS.pressureLevels) {
      findRecord(records, "TCDC", `${pressureHpa} mb`, "24 hour fcst");
    }
  });

  it("GFS carries omega at every curated level", () => {
    // pgrb2.0p25 carries VVEL (Pa/s, instantaneous) at all eight curated
    // levels — verified against the live feed on 2026-08-08 at anl, f001,
    // f024, f240 and f384: no late-horizon thinning.
    const records = f024();
    expect(GFS.verticalVelocity.levels).toBe(GFS.pressureLevels);
    for (const pressureHpa of GFS.verticalVelocity.levels) {
      findRecord(records, "VVEL", `${pressureHpa} mb`, "24 hour fcst");
    }
  });

  it("missing records raise the tolerable error type", () => {
    const records = f024();
    expect(() => findRecord(records, "TCDC", "875 mb", "24 hour fcst")).toThrow(
      MissingRecordError, // not in pgrb2.0p25
    );
    expect(() => findRecord(records, "VVEL", "875 mb", "24 hour fcst")).toThrow(
      MissingRecordError, // ditto — tolerated
    );
  });
});

it("models.json matches the GFS builder configuration", () => {
  const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
    models: Array<{ slug: string; capabilities: Record<string, unknown> }>;
  };
  const capabilities = catalogue.models.find((entry) => entry.slug === "gfs")!.capabilities;

  expect(capabilities["gust"]).toBe("instant"); // NOAA has no hour-max gust
  // APCP mm over the 3 h window ÷ 3 → a window-mean rate, and the
  // documents' own semantics block says the same.
  expect(capabilities["precipitation"]).toBe("windowMeanRate");
  expect(GFS.semantics).toEqual({ gust: "instant", precipitation: "windowMeanRate" });
  expect(capabilities["cape"]).toBe(true);
  expect(capabilities["cin"]).toBe(true);
  expect(capabilities["pblHeight"]).toBe(true);
  expect(capabilities["cloudLayers"]).toBe(true);
  expect(capabilities["cloudProfile"]).toBe(true); // the only model with one
  const optional = Object.keys(GFS.optionalSurfaceFields);
  for (const field of ["windGustMps", "capeJkg", "cinJkg", "pblHeightM"]) {
    expect(optional).toContain(field);
  }
  for (const field of ["lowCloudPercent", "midCloudPercent", "highCloudPercent"]) {
    expect(optional).toContain(field);
  }
  // GFS publishes its own omega (Pa/s, instantaneous) at every curated level.
  expect(capabilities["verticalVelocity"]).toBe("omega");
  expect(capabilities["verticalVelocityLevels"]).toEqual([...GFS.verticalVelocity.levels]);
});

describe("the inverse Magnus derivation the pressure levels ride", () => {
  it("matches hand-checked dewpoints", () => {
    // 20 °C at 50 % RH dews at 9.26 °C; 5 °C at 80 % RH dews at 1.84 °C.
    expect(dewPointDepression(20.0, 50.0)).toBeCloseTo(20.0 - 9.26, 1);
    expect(dewPointDepression(5.0, 80.0)).toBeCloseTo(5.0 - 1.84, 1);
  });

  it("saturated air has no depression", () => {
    expect(dewPointDepression(15.0, 100.0)).toBeCloseTo(0.0, 9);
  });

  it("relative humidity is clamped to a physical range", () => {
    expect(dewPointDepression(20.0, 0.0)).toBe(dewPointDepression(20.0, 1.0));
    expect(dewPointDepression(20.0, 105.0)).toBe(dewPointDepression(20.0, 100.0));
  });
});

const SITE: SampleSite & { timeZone: string } = {
  slug: "boulder",
  name: "Boulder",
  latitude: 40.0,
  longitude: 255.0,
  timeZone: "America/Denver",
};
const LEVEL_HEIGHTS: Record<number, number> = {
  925: 800.0,
  900: 1000.0,
  850: 1500.0,
  800: 2000.0,
  750: 2500.0,
  700: 3000.0,
  650: 3500.0,
  600: 4000.0,
};
const OMEGA_PA_S = -0.421875; // exactly representable: proves verbatim value flow

function fakeIndex(forecastHour: number): IdxRecord[] {
  const forecast = `${forecastHour} hour fcst`;
  const window = `${windowStart(forecastHour)}-${forecastHour} hour`;
  const rows: Array<[string, string, string]> = [
    ["TMP", "2 m above ground", forecast],
    ["DPT", "2 m above ground", forecast],
    ["UGRD", "10 m above ground", forecast],
    ["VGRD", "10 m above ground", forecast],
    ["HGT", "surface", forecast],
    ["TCDC", "entire atmosphere", forecast],
    ["PRMSL", "mean sea level", forecast],
    ["LHTFL", "surface", `${window} ave fcst`],
    ["SHTFL", "surface", `${window} ave fcst`],
    ["APCP", "surface", `${window} acc fcst`],
  ];
  for (const level of GFS.pressureLevels) {
    for (const variable of ["TMP", "RH", "HGT", "UGRD", "VGRD", "TCDC"]) {
      rows.push([variable, `${level} mb`, forecast]);
    }
    // Step 6's 700 mb VVEL is missing from the index: the level must
    // still publish, just without the optional field.
    if (!(forecastHour === 6 && level === 700)) {
      rows.push(["VVEL", `${level} mb`, forecast]);
    }
  }
  return rows.map(([variable, level, token], index) => ({
    variable,
    level,
    forecast: token,
    offset: index * 100,
    length: 100,
  }));
}

function fakeValue(variable: string, level: string, forecast: string): number {
  if (variable === "VVEL") return OMEGA_PA_S;
  if (level === "2 m above ground") return variable === "TMP" ? 293.15 : 283.15;
  if (variable === "HGT") {
    return level === "surface" ? 100.0 : LEVEL_HEIGHTS[Number.parseInt(level, 10)]!;
  }
  if (variable === "TMP") return 273.15;
  if (variable === "RH") return 50.0;
  if (variable === "UGRD" || variable === "VGRD") return 3.0;
  if (variable === "PRMSL") return 101300.0;
  if (variable === "APCP") return forecast.startsWith("0-3") ? 1.5 : 4.5;
  return 25.0; // cloud covers and the fluxes
}

function fakeWire(): NoaaWire {
  return {
    fetchIndex: async (url) => {
      const forecastHour = Number.parseInt(/f(\d{3})\.idx$/.exec(url)![1]!, 10);
      return fakeIndex(forecastHour);
    },
    fetchRecord: async (_url, record) => record,
    sampleSites: (record, sites, _maxKm) => {
      const { variable, level, forecast } = record as IdxRecord;
      const samples: Record<string, GridPointValue> = {};
      for (const site of sites) {
        samples[site.slug] = {
          value: fakeValue(variable, level, forecast),
          latitude: site.latitude,
          longitude: site.longitude,
          distanceKm: 0.0,
        };
      }
      return samples;
    },
  };
}

interface PublishedLevel {
  pressureHpa: number;
  verticalVelocityPaS?: number;
  [key: string]: unknown;
}

interface PublishedProfile {
  site: { timeZone?: string };
  semantics: Record<string, string>;
  hours: Array<{ levels: PublishedLevel[] }>;
}

it("buildProfiles publishes omega and tolerates its absence", async () => {
  const result = await buildProfiles(
    GFS,
    { date: "20260807", hour: "12" },
    "2026-08-07T12:00:00Z",
    [SITE as never],
    new DownloadCounters(),
    { maxSteps: 2, wire: fakeWire() },
  );

  expect(result.profiles).toHaveLength(1);
  expect(result.firstForecastHour).toBe(3);
  expect(result.forecastHours).toBe(2);
  expect(result.lastForecastHour).toBe(6);
  const profile = result.profiles[0] as unknown as PublishedProfile;
  expect(profile.site.timeZone).toBe("America/Denver"); // the catalogue echo
  expect(profile.semantics).toEqual({ gust: "instant", precipitation: "windowMeanRate" });
  const [first, second] = profile.hours;
  // Every curated level carries the sampled omega verbatim: Pa/s in,
  // Pa/s out, no unit conversion anywhere in the flow.
  expect(first!.levels.map((level) => level.pressureHpa)).toEqual(
    [...GFS.pressureLevels].sort((a, b) => b - a),
  );
  expect(first!.levels.every((level) => level.verticalVelocityPaS === OMEGA_PA_S)).toBe(true);
  // The step whose 700 mb VVEL record is absent still publishes the level,
  // complete in its required fields, without the optional one.
  const byPressure = new Map(second!.levels.map((level) => [level.pressureHpa, level]));
  expect([...byPressure.keys()].sort((a, b) => a - b)).toEqual(
    [...GFS.pressureLevels].sort((a, b) => a - b),
  );
  expect(byPressure.get(700)).not.toHaveProperty("verticalVelocityPaS");
  for (const level of GFS.pressureLevels) {
    if (level === 700) continue;
    expect(byPressure.get(level)!.verticalVelocityPaS).toBe(OMEGA_PA_S);
  }
});

it("the fetch pool cap and domain guard hold their catalogued values", () => {
  expect(GFS.fetchConcurrency).toBe(10);
  expect(GFS.maxNearestKm).toBe(30.0);
  expect(GFS.fileUrl("", "20260807", "12", 6)).toBe(
    "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260807/12/atmos/gfs.t12z.pgrb2.0p25.f006",
  );
});

describe("buildGfs", () => {
  let scratch: string | undefined;
  afterEach(() => {
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  function writeSites(directory: string): string {
    const path = join(directory, "sites.json");
    const catalogue = {
      schemaVersion: 2,
      sites: [
        {
          slug: SITE.slug,
          name: SITE.name,
          latitude: SITE.latitude,
          longitude: SITE.longitude,
          timeZone: SITE.timeZone,
        },
      ],
    };
    writeFileSync(path, JSON.stringify(catalogue));
    return path;
  }

  it("skips a run the dataset already publishes", async () => {
    scratch = mkdtempSync(join(tmpdir(), "gfs-test-"));
    const sitesPath = writeSites(scratch);
    const manifest = { model: GFS.slug, referenceTime: "2026-08-07T12:00:00Z", generatedAt: "x" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildNoaa(GFS, {
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-07T12:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["GFS run 2026-08-07T12:00:00Z is already published."]);
  });

  it("rejects a pin that is not a GFS cycle stamp", async () => {
    scratch = mkdtempSync(join(tmpdir(), "gfs-test-"));
    const sitesPath = writeSites(scratch);

    await expect(
      buildNoaa(GFS, { sitesPath, referenceTime: "2026-08-07T13:00:00Z" }),
    ).rejects.toThrow(/not a GFS cycle/);
    await expect(buildNoaa(GFS, { sitesPath, referenceTime: "20260807T12Z" })).rejects.toThrow(
      /not a GFS cycle stamp/,
    );
  });

  it("publishes the tree: rounded site documents, history archive with index, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "gfs-test-"));
    const sitesPath = writeSites(scratch);
    const outputRoot = join(scratch, "data");
    // The empty published dataset: the manifest gate reads 404, then the
    // history seed for the site's month reads 404.
    const dataset = stubFetch([{ status: 404 }, { status: 404 }]);

    const built = await buildNoaa(GFS, {
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-07T12:00:00Z",
      maxSteps: 2,
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      generatedAt: () => "2026-08-07T18:30:00Z",
      log: () => {},
    });

    expect(built).toBe(true);
    const document = JSON.parse(
      readFileSync(join(outputRoot, GFS.slug, "sites", "boulder.json"), "utf-8"),
    ) as {
      schemaVersion: number;
      model: string;
      run: { referenceTime: string; generatedAt: string };
      site: { id: string; modelElevationM: number };
      hours: Array<{ surface: { seaLevelPressureHpa: number; precipitationMmHr: number } }>;
    };
    expect(document.model).toBe(GFS.slug);
    expect(document.run).toEqual({
      referenceTime: "2026-08-07T12:00:00Z",
      generatedAt: "2026-08-07T18:30:00Z",
    });
    expect(document.site.id).toBe("boulder");
    expect(document.site.modelElevationM).toBe(100.0);
    expect(document.hours).toHaveLength(2);
    // PRMSL 101300 Pa → 1013 hPa, rounded per the contract table.
    expect(document.hours[0]!.surface.seaLevelPressureHpa).toBe(1013);
    // f003 APCP is the 0-3 window: 1.5 mm over 3 h → 0.5 mm/h.
    expect(document.hours[0]!.surface.precipitationMmHr).toBe(0.5);
    // f006 needs the f003 companion: 4.5 − 1.5 = 3 mm over (3, 6] → 1 mm/h.
    expect(document.hours[1]!.surface.precipitationMmHr).toBe(1);

    const manifest = JSON.parse(
      readFileSync(join(outputRoot, GFS.slug, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["firstForecastHour"]).toBe(3);
    expect(manifest["forecastHours"]).toBe(2);
    expect(manifest["lastForecastHour"]).toBe(6);
    expect(manifest["model"]).toBe(GFS.slug);
    expect(manifest["referenceTime"]).toBe("2026-08-07T12:00:00Z");
    expect(manifest["schemaVersion"]).toBe(1);
    expect(manifest["sites"]).toEqual([{ name: "Boulder", slug: "boulder" }]);
    expect(Object.keys(manifest["stats"] as Record<string, number>).sort()).toEqual([
      "downloadBytes",
      "downloads",
      "durationMs",
      "retries",
    ]);

    // One run appended as one independent gzip member, one JSON line —
    // and the line IS the site document.
    const archive = readFileSync(
      join(outputRoot, GFS.slug, "history", "boulder", "2026-08.jsonl.gz"),
    );
    const members = splitMembers(archive);
    expect(members).toHaveLength(1);
    expect(members[0]!.lines).toHaveLength(1);
    expect(JSON.parse(members[0]!.lines[0]!)).toEqual(document);

    const index = JSON.parse(
      readFileSync(join(outputRoot, GFS.slug, "history", "boulder", "2026-08.index.json"), "utf-8"),
    ) as { members: Array<{ referenceTime: string; generatedAt: string; lines: number }> };
    expect(index.members).toHaveLength(1);
    expect(index.members[0]!.referenceTime).toBe("2026-08-07T12:00:00Z");
    expect(index.members[0]!.lines).toBe(1);
  });

  it("history is the operator's choice: off writes no archives, on is byte-identical to the default", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gfs-test-"));
    scratch = tmp;
    const sitesPath = writeSites(tmp);
    const build = async (root: string, history?: boolean) => {
      // The manifest gate reads 404; only a history-publishing run also
      // seeds the site's month (the second 404).
      const dataset = stubFetch(
        history === false ? [{ status: 404 }] : [{ status: 404 }, { status: 404 }],
      );
      const built = await buildNoaa(GFS, {
        sitesPath,
        outputRoot: join(tmp, root),
        referenceTime: "2026-08-07T12:00:00Z",
        maxSteps: 2,
        dataset: { fetch: dataset.fetch },
        wire: fakeWire(),
        generatedAt: () => "2026-08-07T18:30:00Z",
        log: () => {},
        ...(history !== undefined ? { history } : {}),
      });
      expect(built).toBe(true);
      return dataset;
    };

    await build("default");
    await build("on", true);
    const off = await build("off", false);

    // Off: no archive, no sidecar index — and no seed read even left the
    // process (the already-published gate was the only dataset request).
    expect(existsSync(join(tmp, "off", GFS.slug, "history"))).toBe(false);
    expect(off.requests).toHaveLength(1);

    // The site documents are identical across all three choices…
    const site = (root: string) => readFileSync(join(tmp, root, GFS.slug, "sites", "boulder.json"));
    expect(site("on").equals(site("default"))).toBe(true);
    expect(site("off").equals(site("default"))).toBe(true);

    // …an explicit --history run is byte-identical to the default,
    // archives and sidecars included…
    const history = (root: string, name: string) =>
      readFileSync(join(tmp, root, GFS.slug, "history", "boulder", name));
    expect(history("on", "2026-08.jsonl.gz").equals(history("default", "2026-08.jsonl.gz"))).toBe(
      true,
    );
    expect(
      history("on", "2026-08.index.json").equals(history("default", "2026-08.index.json")),
    ).toBe(true);

    // …and the manifest does not know the choice was made (its stats and
    // wall-clock stamp are the only fields that vary run to run).
    const manifest = (root: string) => {
      const parsed = JSON.parse(
        readFileSync(join(tmp, root, GFS.slug, "manifest.json"), "utf-8"),
      ) as Record<string, unknown>;
      delete parsed["stats"];
      delete parsed["generatedAt"];
      return parsed;
    };
    expect(manifest("off")).toEqual(manifest("default"));
    expect(manifest("on")).toEqual(manifest("default"));
  });
});
