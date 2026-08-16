import { describe, expect, it } from "vitest";
import {
  buildSoundingScene,
  solveLabelRows,
  solveVerticalLabels,
  type SoundingScene,
} from "../src/sounding.js";
import { deterministicSceneProfile, SCENE_LAUNCH } from "./scene-fixtures.js";
import { dryNeutralProfile } from "./sounding-fixtures.js";

const MARK_LABEL_MIN_GAP = 12;

describe("solveVerticalLabels", () => {
  it("stacks coincident labels to the minimum gap and flags the nudged one for a leader", () => {
    // The field case that demanded the solver: cloud base 2888 m and
    // LCL 2897 m — 9 m apart, ~1.6 px on a default plot.
    const placed = solveVerticalLabels(
      [
        { id: "cloudBase", trueY: 201.6 },
        { id: "lcl", trueY: 200 },
      ],
      { minGapPx: MARK_LABEL_MIN_GAP, topY: 30, bottomY: 500 },
    );
    expect(placed.map((entry) => entry.id)).toEqual(["lcl", "cloudBase"]);
    expect(placed[1].y - placed[0].y).toBeCloseTo(MARK_LABEL_MIN_GAP, 6);
    expect(placed[0].y).toBe(200); // the upper label keeps its true y
    expect(placed[0].leader).toBe(false);
    expect(placed[1].y).toBeCloseTo(212, 6); // nudged 10.4 px — beyond the 4 px threshold
    expect(placed[1].leader).toBe(true);
  });

  it("keeps a label within the threshold leader-free and is order-independent", () => {
    const forward = solveVerticalLabels(
      [
        { id: "a", trueY: 100 },
        { id: "b", trueY: 108 },
      ],
      { minGapPx: MARK_LABEL_MIN_GAP, topY: 30, bottomY: 500 },
    );
    const reversed = solveVerticalLabels(
      [
        { id: "b", trueY: 108 },
        { id: "a", trueY: 100 },
      ],
      { minGapPx: MARK_LABEL_MIN_GAP, topY: 30, bottomY: 500 },
    );
    expect(reversed).toEqual(forward);
    expect(forward[1].y - forward[0].y).toBeCloseTo(MARK_LABEL_MIN_GAP, 6);
    expect(forward[1].y).toBeCloseTo(112, 6); // moved 4 px — at the threshold, no leader
    expect(forward[1].leader).toBe(false);
  });

  it("walks a stack back up when it runs past the bottom bound", () => {
    const placed = solveVerticalLabels(
      [
        { id: "a", trueY: 494 },
        { id: "b", trueY: 496 },
        { id: "c", trueY: 498 },
      ],
      { minGapPx: MARK_LABEL_MIN_GAP, topY: 30, bottomY: 500 },
    );
    expect(placed.map((entry) => entry.y)).toEqual([476, 488, 500]);
    expect(placed.every((entry) => entry.y <= 500)).toBe(true);
  });

  it("breaks exact ties by id, so coincident marks place identically every build", () => {
    const placed = solveVerticalLabels(
      [
        { id: "z", trueY: 250 },
        { id: "a", trueY: 250 },
      ],
      { minGapPx: MARK_LABEL_MIN_GAP, topY: 30, bottomY: 500 },
    );
    expect(placed.map((entry) => entry.id)).toEqual(["a", "z"]);
  });
});

describe("solveLabelRows", () => {
  it("climbs a colliding label one row up — the parcel starts on the temperature trace", () => {
    const placed = solveLabelRows(
      [
        { id: "temperature", naturalX: 300, widthPx: 84 },
        { id: "parcel", naturalX: 300, widthPx: 55 },
        { id: "dewPoint", naturalX: 120, widthPx: 71 },
      ],
      { minX: 52, maxX: 400, gapPx: 10 },
    );
    const byId = new Map(placed.map((entry) => [entry.id, entry]));
    expect(byId.get("dewPoint")?.row).toBe(0);
    expect(byId.get("parcel")?.row).toBe(0);
    expect(byId.get("temperature")?.row).toBe(1); // same wish as parcel, sorted after it by id
  });

  it("clamps a label into the lane instead of overflowing it", () => {
    const placed = solveLabelRows([{ id: "temperature", naturalX: 380, widthPx: 84 }], {
      minX: 52,
      maxX: 400,
      gapPx: 10,
    });
    expect(placed[0].x).toBe(400 - 84);
  });
});

describe("scene label placement", () => {
  function scene(): SoundingScene {
    const built = buildSoundingScene(deterministicSceneProfile(), {
      validAt: "2026-08-09T17:00:00Z",
      launch: SCENE_LAUNCH,
    });
    expect(built).not.toBeNull();
    return built as SoundingScene;
  }

  it("prints one identity label per trace at the surface end, rows apart when traces meet", () => {
    const built = scene();
    const labels = new Map(built.traces.map((trace) => [trace.key, trace.label]));
    expect(labels.get("temperature")?.text).toBe("Temperature");
    expect(labels.get("dewPoint")?.text).toBe("Dew point");
    expect(labels.get("parcel")?.text).toBe("Parcel");
    const plotBottom = built.scales.plotTop + built.scales.plotHeight;
    for (const trace of built.traces) {
      expect(trace.label.y).toBeLessThanOrEqual(plotBottom - 8);
      expect(trace.label.y).toBeGreaterThan(plotBottom - 60);
      // The chip sits before the word and wears the trace's own class.
      expect(trace.label.chip.x2).toBeLessThan(trace.label.x);
    }
    // Parcel and temperature share their surface point, so their labels stack.
    const temperature = labels.get("temperature");
    const parcel = labels.get("parcel");
    expect(Math.abs((temperature?.y ?? 0) - (parcel?.y ?? 0))).toBeGreaterThanOrEqual(13);
  });

  it("solves every mark and LCL label apart, sides chosen away from the traces", () => {
    const built = scene();
    expect(built.markLabels.map((entry) => entry.key).sort()).toEqual(
      ["boundaryLayerTop", "cloudBase", "launch", "lcl", "usableLiftTop"].sort(),
    );
    for (const side of ["start", "end"] as const) {
      const group = built.markLabels
        .filter((entry) => entry.anchor === side)
        .sort((left, right) => left.y - right.y);
      for (let index = 1; index < group.length; index += 1) {
        expect(group[index].y - group[index - 1].y).toBeGreaterThanOrEqual(
          MARK_LABEL_MIN_GAP - 1e-6,
        );
      }
    }
    for (const entry of built.markLabels) {
      if (entry.leader === null) {
        // Unnudged labels hang just above their own line.
        expect(Math.abs(entry.y + 4 - entry.trueY)).toBeLessThanOrEqual(4);
      } else {
        expect(entry.leader.y1).toBeCloseTo(entry.trueY, 6);
      }
    }
  });

  it("stacks a cloud-base line and an LCL nine metres apart instead of overprinting them", () => {
    // First build finds where this column's LCL lands; the second parks the
    // cloud-base mark 9 m below it — the coincidence the redesign was
    // demanded over (cloud base 2888 m vs LCL 2897 m).
    const moist = (cloudBaseM: number | null) => {
      const base = dryNeutralProfile();
      const hour = base.hours[0];
      return {
        ...base,
        hours: [
          {
            ...hour,
            // 4 degC of dew-point depression at the 20 degC fixture surface
            // puts the LCL a few hundred metres up, inside the column.
            surface: { ...hour.surface, dewPointC: 16 },
            derived: {
              ...hour.derived,
              ...(cloudBaseM === null ? {} : { cloudBaseM }),
            },
          },
        ],
      };
    };
    const probe = buildSoundingScene(moist(null), { validAt: "2026-08-09T18:00:00Z" });
    expect(probe?.lcl).not.toBeNull();
    const lclM = probe!.lcl!.altitudeM;
    const built = buildSoundingScene(moist(lclM - 9), { validAt: "2026-08-09T18:00:00Z" });
    expect(built).not.toBeNull();
    const cloudBase = built!.markLabels.find((entry) => entry.key === "cloudBase");
    const lcl = built!.markLabels.find((entry) => entry.key === "lcl");
    expect(cloudBase).toBeDefined();
    expect(lcl).toBeDefined();
    if (cloudBase!.anchor === lcl!.anchor) {
      expect(Math.abs(cloudBase!.y - lcl!.y)).toBeGreaterThanOrEqual(MARK_LABEL_MIN_GAP - 1e-6);
      // At ~1.7 px apart at least one of the two had to move beyond the
      // threshold and earn a leader tick.
      expect([cloudBase!, lcl!].some((entry) => entry.leader !== null)).toBe(true);
    }
  });
});
