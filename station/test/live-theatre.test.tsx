// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AirExtremes, CompassFan, RecentSummaries } from "../src/react/index.js";
import { defaultStrings, lastNightLowC, pressureDeltaHpa, pressureTendency } from "../src/index.js";
import type { LiveSamples, RecentSummary } from "../src/index.js";
import { iso, makePoints, okStation } from "./fixtures.js";

describe("pressureDeltaHpa", () => {
  const points = (deltas: number[]) =>
    deltas.map((value, index) => ({
      observedAt: iso(Date.parse("2026-08-05T12:00:00Z") + index * 30 * 60_000),
      seaLevelPressureHpa: 1010 + value,
    }));

  it("agrees in sign with the tendency word on the same record", () => {
    const rising = points([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(pressureDeltaHpa(rising)).toBeCloseTo(3, 6);
    expect(pressureTendency(rising)).toBe("rising");
    const falling = points([0, -0.5, -1, -1.5, -2, -2.5, -3]);
    expect(pressureDeltaHpa(falling)).toBeCloseTo(-3, 6);
    expect(pressureTendency(falling)).toBe("falling");
  });

  it("returns null on a record covering under 60% of the window", () => {
    expect(pressureDeltaHpa(points([0, 0.5]))).toBeNull();
    expect(pressureDeltaHpa([])).toBeNull();
  });
});

describe("lastNightLowC", () => {
  /* A midsummer 48 h record at hour steps, temperature dipping overnight. */
  const nights = Array.from({ length: 48 }, (_, index) => {
    const observedMs = Date.parse("2026-06-20T00:00:00Z") + index * 3_600_000;
    const hourUtc = new Date(observedMs).getUTCHours();
    return {
      observedAt: iso(observedMs),
      /* Local solar night at -117.8 sits around 05–13 UTC. */
      temperatureC: hourUtc >= 5 && hourUtc <= 13 ? 8 + (hourUtc % 3) : 24,
    };
  });
  const nowMs = Date.parse("2026-06-21T20:00:00Z");

  it("finds the minimum inside the real sunset-to-sunrise window", () => {
    const low = lastNightLowC(nights, 49.07, -117.8, nowMs);
    expect(low).not.toBeNull();
    expect(low?.lowC).toBe(8);
    expect(low != null && low.fromMs < low.toMs).toBe(true);
    expect(low?.toMs).toBeLessThanOrEqual(nowMs);
  });

  it("returns null without coordinates, under a polar sky, or with no carried temperature", () => {
    expect(lastNightLowC(nights, null, -117.8, nowMs)).toBeNull();
    expect(lastNightLowC(nights, 78, 15, nowMs)).toBeNull();
    const dark = nights.map((point) => ({ ...point, temperatureC: null }));
    expect(lastNightLowC(dark, 49.07, -117.8, nowMs)).toBeNull();
  });
});

const ring = (): LiveSamples => ({
  intervalSeconds: 3,
  points: Array.from({ length: 20 }, (_, index) => ({
    observedAt: iso(Date.parse("2026-08-05T22:12:00Z") + index * 3_000),
    windMps: index === 4 ? 0.2 : 5 + (index % 3),
    windDirectionDeg: index === 4 ? null : (280 + index) % 360,
  })),
});

describe("CompassFan", () => {
  it("fans one ghost per non-calm sample, the newest wearing the needle", () => {
    const { container } = render(<CompassFan samples={ring()} />);
    /* Twenty samples: one calm (skipped), the newest as the needle. */
    const ghosts = container.querySelectorAll("path[class^='meteo-fan-ghost-']");
    expect(ghosts.length).toBe(18);
    expect(container.querySelector(".meteo-wind-needle-blade")).not.toBeNull();
    const classes = Array.from(ghosts).map((ghost) => ghost.getAttribute("class"));
    expect(classes[classes.length - 1]).toBe("meteo-fan-ghost-0");
    expect(classes[0]).toBe("meteo-fan-ghost-9");
  });

  it("notes an empty ring, and hides on a station without the live capability", () => {
    const empty = render(<CompassFan samples={{ intervalSeconds: 3, points: [] }} />);
    expect(empty.container.querySelector(".meteo-compass-fan-na")?.textContent).toBe(
      defaultStrings.noSamples,
    );
    const dark = okStation({
      capabilities: { ...okStation().capabilities, live: false },
    });
    const hidden = render(<CompassFan station={dark} />);
    expect(hidden.container.innerHTML).toBe("");
  });

  it("wears the verdict ring only with arcs", () => {
    const bare = render(<CompassFan samples={ring()} />);
    expect(bare.container.querySelector(".meteo-wind-dial-ring-favorable")).toBeNull();
    const judged = render(
      <CompassFan favorableDirections={[{ fromDeg: 260, toDeg: 340 }]} samples={ring()} />,
    );
    expect(judged.container.querySelector("path.meteo-wind-dial-ring-favorable")).not.toBeNull();
  });
});

const blocks = (): RecentSummary[] => [
  {
    windowMinutes: 10,
    stepMinutes: 1,
    points: makePoints(10),
  },
  {
    windowMinutes: 60,
    stepMinutes: 5,
    points: makePoints(12, (point, index) => ({
      ...point,
      windGustMps: index === 0 ? null : point.windGustMps,
    })),
  },
];

describe("RecentSummaries", () => {
  it("renders one panel per block with the step ghosts and window words", () => {
    const { container } = render(<RecentSummaries summaries={blocks()} />);
    const panels = container.querySelectorAll(".meteo-recent-summary");
    expect(panels.length).toBe(2);
    expect(panels[0]?.querySelector("h4")?.textContent).toBe(defaultStrings.recentWindowLabel(10));
    expect(panels[1]?.querySelector("h4")?.textContent).toBe(defaultStrings.recentWindowLabel(60));
    expect(panels[0]?.querySelectorAll(".meteo-recent-summary-ghost").length).toBe(10);
    expect(panels[1]?.querySelectorAll(".meteo-recent-summary-ghost").length).toBe(12);
  });

  it("notes a dark block on a declaring station, hides on one that never declares", () => {
    const declaring = okStation({
      capabilities: { ...okStation().capabilities, recentSummaries: true },
      recentSummaries: null,
    });
    const dark = render(<RecentSummaries station={declaring} />);
    expect(dark.container.querySelector(".meteo-recent-summaries-na")?.textContent).toBe(
      defaultStrings.noSamples,
    );
    const undeclared = render(<RecentSummaries station={okStation()} />);
    expect(undeclared.container.innerHTML).toBe("");
  });
});

describe("AirExtremes", () => {
  it("tiles the last night's low and the pressure delta from served history", () => {
    const points = Array.from({ length: 48 }, (_, index) => {
      const observedMs = Date.parse("2026-06-20T00:00:00Z") + index * 3_600_000;
      const hourUtc = new Date(observedMs).getUTCHours();
      return {
        observedAt: iso(observedMs),
        windAvgMps: 3,
        windGustMps: null,
        windLullMps: null,
        windDirectionDeg: 90,
        temperatureC: hourUtc >= 5 && hourUtc <= 13 ? 7.5 : 22,
        seaLevelPressureHpa: 1008 + index * 0.1,
      };
    });
    const station = okStation({
      latitude: 49.07,
      longitude: -117.8,
      history: { periodMinutes: 60, points },
    });
    const { container } = render(
      <AirExtremes nowMs={Date.parse("2026-06-21T20:00:00Z")} station={station} />,
    );
    const tiles = container.querySelectorAll(".meteo-air-extremes-tile");
    expect(tiles.length).toBe(2);
    expect(tiles[0]?.textContent).toContain(defaultStrings.lastNightLowLabel);
    expect(tiles[0]?.textContent).toContain("7.5 °C");
    expect(tiles[1]?.textContent).toContain(defaultStrings.pressureDeltaLabel(3));
    expect(tiles[1]?.textContent).toContain("+0.3 hPa");
  });

  it("renders nothing at all when nothing is derivable", () => {
    const coordless = okStation({ latitude: null, longitude: null });
    const { container } = render(
      <AirExtremes nowMs={Date.parse("2026-06-21T20:00:00Z")} station={coordless} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
