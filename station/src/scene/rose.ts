import type { HistoryPoint, Station } from "../contract.js";
import { normalizeDegrees, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds } from "../derive.js";
import { speedBand, windRose } from "../geometry.js";
import type { WindRoseSummary } from "../geometry.js";
import {
  ROSE_CARDINAL_LETTERS,
  ROSE_CENTRE,
  ROSE_FAVORABLE_RING_RADIUS,
  ROSE_HUB_DOT_RADIUS,
  ROSE_HUB_RADIUS,
  ROSE_INTERCARDINAL_BEARINGS,
  ROSE_LETTER_RADIUS,
  ROSE_MAX_RADIUS,
  ROSE_PETAL_FILL,
  ROSE_SIZE,
  ROSE_TICK_REACH,
  roseBandPath,
  rosePetalPath,
  rosePolar,
  roseRingArcPath,
} from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";

export const WIND_ROSE_CLASS = "meteo-wind-rose";

export function windRoseSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): ReadonlyArray<HistoryPoint> {
  return points ?? (station?.status === "ok" ? station.history?.points : null) ?? [];
}

export function windRoseScene(
  input: {
    favorableDirections: FavorableDirection[] | undefined;
    sectorCount: number;
    source: ReadonlyArray<HistoryPoint>;
    stationName: string | undefined;
    /** A pre-aggregated summary (the climatology cube's road); given, the
     * source is not consulted. Sectors carrying bandCounts draw as stacked
     * wedges. */
    summary?: WindRoseSummary | undefined;
    thresholds: SpeedThresholds | undefined;
    words: StationStrings;
  },
  /** Appended after the drawing — the climatology twin's caption row. */
  extra: SceneChild[] = [],
): SceneNode {
  const { favorableDirections, source, stationName, thresholds, words } = input;
  if (input.summary == null && source.length === 0) {
    return el(
      "div",
      { class: "meteo-wind-rose meteo-wind-rose-na", role: "note" },
      words.noHistory,
    );
  }
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  const rose = input.summary ?? windRose(source, input.sectorCount);
  const sectorCount = rose.sectors.length;
  const maxFrequency = Math.max(...rose.sectors.map((sector) => sector.frequency));
  const halfWidthDeg = (360 / sectorCount / 2) * ROSE_PETAL_FILL;
  const [ringLabelX, ringLabelY] = rosePolar(135, ROSE_MAX_RADIUS);
  const favorable = favorableDirections != null && favorableDirections.length > 0;
  const baseLabel = stationName != null ? words.aria.rose(stationName) : words.aria.roseGeneric;
  const roseLabel =
    favorable && favorableDirections != null
      ? `${baseLabel} ${words.aria.roseFavorable(
          favorableDirections
            .map(
              (sector) =>
                `${Math.round(normalizeDegrees(sector.fromDeg))}\u00b0\u2013${Math.round(
                  normalizeDegrees(sector.toDeg),
                )}\u00b0`,
            )
            .join(", "),
        )}`
      : baseLabel;

  const petals: SceneChild[] = rose.sectors.flatMap((sector): SceneChild[] => {
    if (sector.count === 0 || maxFrequency === 0) return [];
    const radius =
      ROSE_HUB_RADIUS + (sector.frequency / maxFrequency) * (ROSE_MAX_RADIUS - ROSE_HUB_RADIUS);
    /* A sector carrying bandCounts draws as a stacked wedge: one radial
     * segment per occupied band, calmest at the hub, shares of the
     * sector's own count. */
    if (sector.bandCounts != null) {
      let cumulative = 0;
      return sector.bandCounts.flatMap((bandCount, band) => {
        if (bandCount === 0) return [];
        const innerRadius =
          ROSE_HUB_RADIUS + (cumulative / sector.count) * (radius - ROSE_HUB_RADIUS);
        cumulative += bandCount;
        const outerRadius =
          ROSE_HUB_RADIUS + (cumulative / sector.count) * (radius - ROSE_HUB_RADIUS);
        return [
          keyed(`${sector.bearingDeg}-${band}`, "path", {
            class: `meteo-wind-rose-petal meteo-band-${band}`,
            d: roseBandPath(sector.bearingDeg, innerRadius, outerRadius, halfWidthDeg),
          }),
        ];
      });
    }
    const banded =
      boundsMps != null && sector.meanSpeedMps != null
        ? ` meteo-band-${speedBand(sector.meanSpeedMps, boundsMps)}`
        : "";
    return [
      keyed(String(sector.bearingDeg), "path", {
        class: `meteo-wind-rose-petal${banded}`,
        d: rosePetalPath(sector.bearingDeg, radius, halfWidthDeg),
      }),
    ];
  });

  return el(
    "div",
    { class: WIND_ROSE_CLASS },
    el(
      "svg",
      {
        "aria-label": roseLabel,
        class: "meteo-wind-rose-svg",
        height: ROSE_SIZE,
        role: "img",
        viewBox: `0 0 ${ROSE_SIZE} ${ROSE_SIZE}`,
        width: ROSE_SIZE,
      },
      [1, 2 / 3, 1 / 3].map((fraction) =>
        keyed(String(fraction), "circle", {
          class: "meteo-wind-rose-grid",
          cx: ROSE_CENTRE,
          cy: ROSE_CENTRE,
          r: ROSE_MAX_RADIUS * fraction,
        }),
      ),
      favorable && favorableDirections != null
        ? [
            el("circle", {
              class: "meteo-wind-rose-ring-unfavorable",
              cx: ROSE_CENTRE,
              cy: ROSE_CENTRE,
              r: ROSE_FAVORABLE_RING_RADIUS,
            }),
            ...favorableDirections.map((sector) =>
              keyed(`${sector.fromDeg}-${sector.toDeg}`, "path", {
                class: "meteo-wind-rose-ring-favorable",
                d: roseRingArcPath(sector),
              }),
            ),
          ]
        : [],
      ROSE_INTERCARDINAL_BEARINGS.map((bearing) => {
        const [x1, y1] = rosePolar(bearing, ROSE_MAX_RADIUS - ROSE_TICK_REACH);
        const [x2, y2] = rosePolar(bearing, ROSE_MAX_RADIUS + ROSE_TICK_REACH);
        return keyed(String(bearing), "line", {
          class: "meteo-wind-rose-tick",
          x1,
          x2,
          y1,
          y2,
        });
      }),
      ROSE_CARDINAL_LETTERS.map(({ bearing, letter }) => {
        const [x, y] = rosePolar(bearing, ROSE_LETTER_RADIUS);
        return keyed(
          letter,
          "text",
          { class: "meteo-wind-rose-letter", "text-anchor": "middle", x, y: y + 4 },
          letter,
        );
      }),
      petals,
      maxFrequency > 0
        ? el(
            "text",
            {
              class: "meteo-wind-rose-ring-label",
              "text-anchor": "start",
              x: ringLabelX + 3,
              y: ringLabelY + 9,
            },
            words.percentShare(Math.round(maxFrequency * 100)),
          )
        : null,
      el("circle", {
        class: "meteo-wind-rose-hub",
        cx: ROSE_CENTRE,
        cy: ROSE_CENTRE,
        r: ROSE_HUB_RADIUS,
      }),
      el("circle", {
        class: "meteo-wind-rose-dot",
        cx: ROSE_CENTRE,
        cy: ROSE_CENTRE,
        r: ROSE_HUB_DOT_RADIUS,
      }),
    ),
    rose.calmFraction > 0
      ? el(
          "p",
          { class: "meteo-wind-rose-calm" },
          words.percentCalm(Math.round(rose.calmFraction * 100)),
        )
      : null,
    extra,
  );
}
