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

export const WIND_ROSE_CLASS = "meteo-wind-rose";

export function windRoseSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): ReadonlyArray<HistoryPoint> {
  return points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
}

export type WindRoseGate = { kind: "draw" } | { kind: "note"; className: string; text: string };

export function windRoseGate(
  source: ReadonlyArray<HistoryPoint>,
  words: StationStrings,
): WindRoseGate {
  if (source.length === 0) {
    return {
      kind: "note",
      className: `${WIND_ROSE_CLASS} meteo-wind-rose-na`,
      text: words.noHistory,
    };
  }
  return { kind: "draw" };
}

type RoseCircle = { className: string; cx: number; cy: number; r: number };

export type WindRoseScene = {
  className: string;
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  gridCircles: Array<{ key: number } & RoseCircle>;
  ring: {
    unfavorable: RoseCircle;
    favorable: Array<{ key: string; className: string; d: string }>;
  } | null;
  ticks: Array<{ key: number; className: string; x1: number; x2: number; y1: number; y2: number }>;
  letters: Array<{
    key: string;
    className: string;
    anchor: "middle";
    x: number;
    y: number;
    text: string;
  }>;
  petals: Array<{ key: number | string; className: string; d: string }>;
  ringLabel: { className: string; anchor: "start"; x: number; y: number; text: string } | null;
  hub: RoseCircle;
  dot: RoseCircle;
  calmCaption: { className: string; text: string } | null;
};

export function windRoseScene(input: {
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
}): WindRoseScene {
  const { favorableDirections, source, stationName, thresholds, words } = input;
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  const rose = input.summary ?? windRose(source, input.sectorCount);
  const sectorCount = rose.sectors.length;
  const maxFrequency = Math.max(...rose.sectors.map((sector) => sector.frequency));
  const halfWidthDeg = (360 / sectorCount / 2) * ROSE_PETAL_FILL;
  const calmPercent = Math.round(rose.calmFraction * 100);
  const [ringLabelX, ringLabelY] = rosePolar(135, ROSE_MAX_RADIUS);
  const favorable = favorableDirections != null && favorableDirections.length > 0;
  const baseLabel = stationName != null ? words.aria.rose(stationName) : words.aria.roseGeneric;
  const roseLabel =
    favorable && favorableDirections != null
      ? `${baseLabel} ${words.aria.roseFavorable(
          favorableDirections
            .map(
              (sector) =>
                `${Math.round(normalizeDegrees(sector.fromDeg))}°–${Math.round(
                  normalizeDegrees(sector.toDeg),
                )}°`,
            )
            .join(", "),
        )}`
      : baseLabel;

  return {
    className: WIND_ROSE_CLASS,
    svg: {
      ariaLabel: roseLabel,
      className: "meteo-wind-rose-svg",
      height: ROSE_SIZE,
      viewBox: `0 0 ${ROSE_SIZE} ${ROSE_SIZE}`,
      width: ROSE_SIZE,
    },
    gridCircles: [1, 2 / 3, 1 / 3].map((fraction) => ({
      key: fraction,
      className: "meteo-wind-rose-grid",
      cx: ROSE_CENTRE,
      cy: ROSE_CENTRE,
      r: ROSE_MAX_RADIUS * fraction,
    })),
    ring:
      favorable && favorableDirections != null
        ? {
            unfavorable: {
              className: "meteo-wind-rose-ring-unfavorable",
              cx: ROSE_CENTRE,
              cy: ROSE_CENTRE,
              r: ROSE_FAVORABLE_RING_RADIUS,
            },
            favorable: favorableDirections.map((sector) => ({
              key: `${sector.fromDeg}-${sector.toDeg}`,
              className: "meteo-wind-rose-ring-favorable",
              d: roseRingArcPath(sector),
            })),
          }
        : null,
    ticks: ROSE_INTERCARDINAL_BEARINGS.map((bearing) => {
      const [x1, y1] = rosePolar(bearing, ROSE_MAX_RADIUS - ROSE_TICK_REACH);
      const [x2, y2] = rosePolar(bearing, ROSE_MAX_RADIUS + ROSE_TICK_REACH);
      return { key: bearing, className: "meteo-wind-rose-tick", x1, x2, y1, y2 };
    }),
    letters: ROSE_CARDINAL_LETTERS.map(({ bearing, letter }) => {
      const [x, y] = rosePolar(bearing, ROSE_LETTER_RADIUS);
      return {
        key: letter,
        className: "meteo-wind-rose-letter",
        anchor: "middle" as const,
        x,
        y: y + 4,
        text: letter,
      };
    }),
    petals: rose.sectors.flatMap(
      (sector): Array<{ key: number | string; className: string; d: string }> => {
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
              {
                key: `${sector.bearingDeg}-${band}`,
                className: `meteo-wind-rose-petal meteo-band-${band}`,
                d: roseBandPath(sector.bearingDeg, innerRadius, outerRadius, halfWidthDeg),
              },
            ];
          });
        }
        const banded =
          boundsMps != null && sector.meanSpeedMps != null
            ? ` meteo-band-${speedBand(sector.meanSpeedMps, boundsMps)}`
            : "";
        return [
          {
            key: sector.bearingDeg,
            className: `meteo-wind-rose-petal${banded}`,
            d: rosePetalPath(sector.bearingDeg, radius, halfWidthDeg),
          },
        ];
      },
    ),
    ringLabel:
      maxFrequency > 0
        ? {
            className: "meteo-wind-rose-ring-label",
            anchor: "start" as const,
            x: ringLabelX + 3,
            y: ringLabelY + 9,
            text: words.percentShare(Math.round(maxFrequency * 100)),
          }
        : null,
    hub: { className: "meteo-wind-rose-hub", cx: ROSE_CENTRE, cy: ROSE_CENTRE, r: ROSE_HUB_RADIUS },
    dot: {
      className: "meteo-wind-rose-dot",
      cx: ROSE_CENTRE,
      cy: ROSE_CENTRE,
      r: ROSE_HUB_DOT_RADIUS,
    },
    calmCaption:
      rose.calmFraction > 0
        ? { className: "meteo-wind-rose-calm", text: words.percentCalm(calmPercent) }
        : null,
  };
}
