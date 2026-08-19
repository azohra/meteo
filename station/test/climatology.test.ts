import { describe, expect, it } from "vitest";
import {
  METEOROLOGICAL_SEASON_MONTHS,
  accumulatedCells,
  climatologyCoverage,
  climatologyFavorableShare,
  climatologyPattern,
  climatologyRose,
  createClimatologyAccumulator,
  dailyPattern,
  foldClimatologyPoints,
  windRose,
} from "../src/index.js";
import type { HistoryPoint, StationClimatology } from "../src/index.js";
import { loadWindnerdClimatology, windnerdStationConfigSchema } from "../src/server/index.js";
import { iso, makePoints } from "./fixtures.js";
import {
  sseResponse,
  stubEnvironment,
  windnerdLiveInitPayload,
  windnerdPayload,
} from "./support.js";

const THRESHOLDS_MPS = [3, 6, 9];

/* A synthetic season: hour steps across weeks, directions sweeping the
 * compass, speeds cycling every band, a calm run mixed in. */
function seasonPoints(): HistoryPoint[] {
  return makePoints(600, (point, index) => ({
    ...point,
    observedAt: iso(Date.parse("2026-01-05T00:00:00Z") + index * 3 * 3_600_000),
    windAvgMps: index % 7 === 0 ? 0.2 : (index % 11) + 0.5,
    windGustMps: index % 7 === 0 ? 0.4 : (index % 11) + 3,
    windDirectionDeg: index % 7 === 0 ? null : (index * 37) % 360,
  }));
}

function buildDocument(
  points: ReadonlyArray<HistoryPoint>,
  utcOffsetMinutes = 0,
): StationClimatology {
  const accumulator = createClimatologyAccumulator({
    sectorCount: 16,
    slotMinutes: 180,
    thresholdsMps: THRESHOLDS_MPS,
    utcOffsetMinutes,
  });
  foldClimatologyPoints(accumulator, points);
  return {
    schemaVersion: 1,
    servedAt: iso(Date.parse("2026-08-05T22:13:00Z")),
    stationId: "bluff",
    sectorCount: 16,
    slotMinutes: 180,
    thresholdsMps: THRESHOLDS_MPS,
    utcOffsetMinutes,
    years: [{ year: 2026, sampleCount: points.length, expectedCount: points.length }],
    cells: accumulatedCells(accumulator),
  };
}

describe("the cube re-aggregates losslessly", () => {
  it("climatologyRose over the whole cube equals windRose over the same points", () => {
    const points = seasonPoints();
    const direct = windRose(points, 16, { bandThresholdsMps: THRESHOLDS_MPS });
    const fromCube = climatologyRose(buildDocument(points));

    expect(fromCube.sampleCount).toBe(direct.sampleCount);
    expect(fromCube.calmFraction).toBeCloseTo(direct.calmFraction, 12);
    for (const [index, sector] of direct.sectors.entries()) {
      const cubed = fromCube.sectors[index];
      expect(cubed?.bearingDeg).toBe(sector.bearingDeg);
      expect(cubed?.count).toBe(sector.count);
      expect(cubed?.frequency).toBeCloseTo(sector.frequency, 12);
      expect(cubed?.bandCounts).toEqual(sector.bandCounts);
      expect(cubed?.maxGustMps).toBe(sector.maxGustMps);
      if (sector.meanSpeedMps == null) {
        expect(cubed?.meanSpeedMps).toBeNull();
      } else {
        expect(cubed?.meanSpeedMps).toBeCloseTo(sector.meanSpeedMps, 5);
      }
    }
  });

  it("climatologyPattern over the whole cube equals dailyPattern over the same points", () => {
    const points = seasonPoints();
    const direct = dailyPattern(points, { slotMinutes: 180 });
    const fromCube = climatologyPattern(buildDocument(points));
    expect(fromCube).toHaveLength(direct.length);
    for (const [index, slot] of direct.entries()) {
      const cubed = fromCube[index];
      expect(cubed?.startMinuteOfDay).toBe(slot.startMinuteOfDay);
      expect(cubed?.sampleCount).toBe(slot.sampleCount);
      expect(cubed?.speedMps).toBeCloseTo(slot.speedMps, 5);
      if (slot.windDirectionDeg == null) {
        expect(cubed?.windDirectionDeg).toBeNull();
      } else {
        expect(cubed?.windDirectionDeg).toBeCloseTo(slot.windDirectionDeg, 3);
      }
    }
  });

  it("a month filter equals folding only that month's points", () => {
    const points = seasonPoints();
    const january = points.filter((point) => new Date(point.observedAt).getUTCMonth() === 0);
    const filtered = climatologyRose(buildDocument(points), { months: [1] });
    const direct = windRose(january, 16, { bandThresholdsMps: THRESHOLDS_MPS });
    expect(filtered.sampleCount).toBe(direct.sampleCount);
    expect(filtered.sectors.map((sector) => sector.count)).toEqual(
      direct.sectors.map((sector) => sector.count),
    );
  });
});

describe("cube honesty", () => {
  it("counts calm in the bucket and never in a sector", () => {
    const document = buildDocument(seasonPoints());
    for (const cell of document.cells) {
      const sectorTotal = cell.sectors.reduce((sum, sector) => sum + sector.count, 0);
      expect(sectorTotal + cell.calmCount).toBe(cell.sampleCount);
    }
  });

  it("keeps a bucket nothing fell into absent, and a filter to it empty", () => {
    const document = buildDocument(seasonPoints());
    expect(document.cells.some((cell) => cell.month === 12)).toBe(false);
    const december = climatologyRose(document, { months: [12] });
    expect(december.sampleCount).toBe(0);
    expect(december.sectors.every((sector) => sector.count === 0)).toBe(true);
    /* Season months resolve like any other filter. */
    const summer = climatologyRose(document, { months: METEOROLOGICAL_SEASON_MONTHS.summer });
    expect(summer.sampleCount).toBe(0);
  });

  it("sums the year ledger into one coverage figure", () => {
    const document = buildDocument(seasonPoints());
    document.years = [
      { year: 2025, sampleCount: 100, expectedCount: 400 },
      { year: 2026, sampleCount: 200, expectedCount: 200 },
    ];
    expect(climatologyCoverage(document)).toEqual({
      sampleCount: 300,
      expectedCount: 600,
      ratio: 0.5,
    });
  });

  it("judges favorable share at sector centres and returns null with nothing non-calm", () => {
    const northerly = makePoints(10, (point) => ({ ...point, windDirectionDeg: 0 }));
    const document = buildDocument(northerly);
    expect(climatologyFavorableShare(document, [{ fromDeg: 315, toDeg: 45 }])).toBe(1);
    expect(climatologyFavorableShare(document, [{ fromDeg: 90, toDeg: 180 }])).toBe(0);
    expect(climatologyFavorableShare(document, [])).toBeNull();

    const calm = buildDocument(
      makePoints(5, (point) => ({ ...point, windAvgMps: 0.2, windDirectionDeg: null })),
    );
    expect(calm.cells.every((cell) => cell.sectors.length === 0)).toBe(true);
    expect(climatologyFavorableShare(calm, [{ fromDeg: 0, toDeg: 359 }])).toBeNull();
  });

  it("buckets in the station's standard time, not UTC", () => {
    /* 23:30Z on Jan 31 is 15:30 the previous slot-day at UTC-8 — and still
     * January; 01:00Z on Feb 1 is Jan 31 17:00 local. */
    const point: HistoryPoint = {
      observedAt: iso(Date.parse("2026-02-01T01:00:00Z")),
      windAvgMps: 5,
      windGustMps: null,
      windLullMps: null,
      windDirectionDeg: 90,
      temperatureC: null,
    };
    const utc = buildDocument([point], 0);
    const pacific = buildDocument([point], -480);
    expect(utc.cells[0]?.month).toBe(2);
    expect(utc.cells[0]?.slot).toBe(0);
    expect(pacific.cells[0]?.month).toBe(1);
    expect(pacific.cells[0]?.slot).toBe(5);
  });
});

describe("loadWindnerdClimatology", () => {
  const config = windnerdStationConfigSchema.parse({
    vendor: "windnerd",
    id: "bluff",
    name: "Bluff Launch",
    stationKey: "bluff-launch",
    locationId: 8675,
    elevationM: 1370,
  });
  const thresholds = { unit: "kmh" as const, values: [12, 20, 28] };

  const route =
    (recordsByYear: Record<string, string>) =>
    (url: URL): string | Response => {
      if (url.pathname.includes("/api/live-url/")) {
        return sseResponse({ data: windnerdLiveInitPayload() });
      }
      const year = url.searchParams.get("from")?.slice(0, 4) ?? "";
      return recordsByYear[year] ?? windnerdPayload();
    };

  it("fans out one request per calendar year at the vendor's climatology period", async () => {
    const { environment, requests } = stubEnvironment(route({}));
    const document = await loadWindnerdClimatology(config, {
      thresholds,
      years: 3,
      environment,
    });
    const recordRequests = requests.filter((url) => url.pathname === "/api/records");
    expect(recordRequests).toHaveLength(3);
    expect(recordRequests.map((url) => url.searchParams.get("period"))).toEqual([
      "180",
      "180",
      "180",
    ]);
    expect(recordRequests.map((url) => url.searchParams.get("from")?.slice(0, 4))).toEqual([
      "2024",
      "2025",
      "2026",
    ]);
    /* The standard offset rides the cached location block. */
    expect(document.utcOffsetMinutes).toBe(-480);
    expect(document.thresholdsMps.map((bound) => Math.round(bound * 100) / 100)).toEqual([
      3.33, 5.56, 7.78,
    ]);
    /* A second build is cache-served end to end. */
    await loadWindnerdClimatology(config, { thresholds, years: 3, environment });
    expect(requests.filter((url) => url.pathname === "/api/records")).toHaveLength(3);
  });

  it("trims leading years that predate the station, keeps an interior outage", async () => {
    const empty = windnerdPayload({
      date_utc: [],
      wind_avg_1D: [],
      wind_avg_2D: [],
      wind_dir: [],
      wind_max: [],
      wind_min: [],
      temperature_avg: [],
      pressure_hpa_avg: [],
    });
    const { environment } = stubEnvironment(route({ "2024": empty }));
    const document = await loadWindnerdClimatology(config, {
      thresholds,
      years: 3,
      environment,
    });
    expect(document.years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(document.years[0]?.expectedCount).toBe(365 * 8);

    const outage = stubEnvironment(route({ "2025": empty }));
    const withOutage = await loadWindnerdClimatology(config, {
      thresholds,
      years: 3,
      environment: outage.environment,
    });
    expect(withOutage.years.map((year) => [year.year, year.sampleCount])).toEqual([
      [2024, 3],
      [2025, 0],
      [2026, 3],
    ]);
  });

  it("fails the whole document when a year is refused — a missing year would read as an outage", async () => {
    const { environment } = stubEnvironment((url) =>
      url.pathname.includes("/api/live-url/")
        ? sseResponse({ data: windnerdLiveInitPayload() })
        : url.searchParams.get("from")?.startsWith("2025")
          ? new Response("down", { status: 502 })
          : windnerdPayload(),
    );
    await expect(
      loadWindnerdClimatology(config, { thresholds, years: 3, environment }),
    ).rejects.toThrow("502");
  });

  it("rejects a slot width the record period cannot fill", async () => {
    const { environment } = stubEnvironment(route({}));
    await expect(
      loadWindnerdClimatology(config, { thresholds, slotMinutes: 60, environment }),
    ).rejects.toThrow("slotMinutes");
  });
});
