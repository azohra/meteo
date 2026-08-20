// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ClimatologyDailyPattern,
  ClimatologyRose,
  StationFeedProvider,
} from "../src/react/index.js";
import {
  accumulatedCells,
  createClimatologyAccumulator,
  defaultStrings,
  foldClimatologyPoints,
} from "../src/index.js";
import type { HistoryPoint, StationClimatology } from "../src/index.js";
import { feedFixture, iso, makePoints, okStation } from "./fixtures.js";

const THRESHOLDS_MPS = [3, 6, 9];

function seasonPoints(): HistoryPoint[] {
  return makePoints(240, (point, index) => ({
    ...point,
    observedAt: iso(Date.parse("2026-01-05T00:00:00Z") + index * 3 * 3_600_000),
    windAvgMps: index % 6 === 0 ? 0.2 : (index % 10) + 0.5,
    windDirectionDeg: index % 6 === 0 ? null : (index * 53) % 360,
  }));
}

function document(points: HistoryPoint[] = seasonPoints()): StationClimatology {
  const accumulator = createClimatologyAccumulator({
    sectorCount: 16,
    slotMinutes: 180,
    thresholdsMps: THRESHOLDS_MPS,
    utcOffsetMinutes: 0,
  });
  foldClimatologyPoints(accumulator, points);
  return {
    schemaVersion: 1,
    servedAt: iso(Date.parse("2026-08-05T22:13:00Z")),
    stationId: "bluff",
    sectorCount: 16,
    slotMinutes: 180,
    thresholdsMps: THRESHOLDS_MPS,
    utcOffsetMinutes: 0,
    years: [
      {
        year: 2026,
        sampleCount: points.length,
        expectedCount: points.length * 2,
        coveredSlotCount: points.length,
        expectedSlotCount: points.length * 2,
      },
    ],
    cells: accumulatedCells(accumulator),
  };
}

describe("ClimatologyRose", () => {
  it("notes the absence of a document rather than drawing an empty rose", () => {
    const { container } = render(<ClimatologyRose document={null} />);
    expect(container.querySelector(".meteo-climatology-rose-na")?.textContent).toBe(
      defaultStrings.noClimatology,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("stacks each wedge by the document's own bands and captions the coverage", () => {
    const { container } = render(<ClimatologyRose document={document()} />);
    const petals = container.querySelectorAll(".meteo-wind-rose-petal");
    expect(petals.length).toBeGreaterThan(16);
    const banded = Array.from(petals).filter((petal) =>
      /meteo-band-\d/.test(petal.getAttribute("class") ?? ""),
    );
    expect(banded.length).toBe(petals.length);
    /* The unfiltered view carries samples · coverage; expected is twice the
     * samples, so 50%. */
    const caption = container.querySelector(".meteo-climatology-caption");
    expect(caption?.textContent).toBe(defaultStrings.dailyPatternCoverage(240, 50));
  });

  it("filters client-side and drops the coverage claim it can no longer vouch for", () => {
    const { container } = render(<ClimatologyRose document={document()} months={[1]} />);
    const caption = container.querySelector(".meteo-climatology-caption");
    expect(caption?.textContent).toMatch(/samples$|samples\b/);
    expect(caption?.textContent).not.toContain("·");
  });

  it("states the favorable share from ambient arcs, and none without arcs", () => {
    const bare = render(<ClimatologyRose document={document()} />);
    expect(bare.container.querySelector(".meteo-climatology-caption-favorable")).toBeNull();

    const feed = feedFixture([okStation()]);
    const withArcs = render(
      <StationFeedProvider
        favorableDirections={[{ fromDeg: 260, toDeg: 340 }]}
        feed={feed}
        receivedAtMs={Date.now()}
      >
        <ClimatologyRose document={document()} />
      </StationFeedProvider>,
    );
    const favorable = withArcs.container.querySelector(".meteo-climatology-caption-favorable");
    expect(favorable?.textContent).toMatch(/% favorable$/);
    expect(withArcs.container.querySelector("path.meteo-wind-rose-ring-favorable")).not.toBeNull();
  });
});

describe("ClimatologyDailyPattern", () => {
  it("notes the absence of a document", () => {
    const { container } = render(<ClimatologyDailyPattern document={null} />);
    expect(container.querySelector(".meteo-climatology-daily-pattern-na")?.textContent).toBe(
      defaultStrings.noClimatology,
    );
  });

  it("draws the typical day from the cube with the coverage caption", () => {
    const { container } = render(<ClimatologyDailyPattern document={document()} />);
    expect(container.querySelector(".meteo-climatology-daily-pattern")).not.toBeNull();
    expect(container.querySelector(".meteo-daily-pattern-caption")?.textContent).toBe(
      defaultStrings.dailyPatternCoverage(240, 50),
    );
    expect(container.querySelector(".meteo-daily-pattern-svg")).not.toBeNull();
    expect(container.querySelectorAll(".meteo-wind-vane-label").length).toBeGreaterThan(0);
  });

  it("captions a month slice with the plain sample count", () => {
    const { container } = render(<ClimatologyDailyPattern document={document()} months={[1]} />);
    const caption = container.querySelector(".meteo-daily-pattern-caption");
    expect(caption?.textContent).not.toContain("·");
  });
});
