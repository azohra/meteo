import type { HistoryPoint, Station } from "../contract.js";
import { thresholdsToMps } from "../derive.js";
import type { SpeedThresholds } from "../derive.js";
import { speedBand } from "../geometry.js";
import { bandStrips, historyRuns, sparklineScale } from "../instruments.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export type SparklineTracePart =
  | { kind: "dot"; key: string; className: string; cx: number; cy: number; r: number }
  | { kind: "polyline"; key: string; className: string; points: string }
  | {
      kind: "segment";
      key: string;
      className: string;
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    };

export type SparklineScene =
  | {
      kind: "placeholder";
      ariaLabel: string;
      className: string;
      height: number;
      text: string;
      width: number;
    }
  | {
      kind: "draw";
      svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
      bands: Array<{ key: string; className: string; points: string }>;
      trace: SparklineTracePart[];
    };

export function sparklineScene(input: {
  height: number;
  showBand: boolean;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  width: number;
  words: StationStrings;
}): SparklineScene {
  const { height, showBand, station, thresholds, width, words } = input;
  const label = words.aria.sparkline(station.name);

  const history = station.status === "ok" ? station.history : null;
  const drawable = station.capabilities.history && history != null && history.points.length >= 2;

  if (!drawable || history == null) {
    return {
      kind: "placeholder",
      ariaLabel: label,
      className: "meteo-sparkline meteo-sparkline-na",
      height,
      text: EM_DASH,
      width,
    };
  }

  const points = history.points;
  const { xAt, yAt } = sparklineScale(points, width, height);
  const runs = historyRuns(points, history.periodMinutes);
  const strips = showBand ? bandStrips(runs) : [];

  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  const trace: SparklineTracePart[] =
    boundsMps == null
      ? runs.map((segment) =>
          segment.points.length === 1
            ? {
                kind: "dot" as const,
                key: segment.startedAt,
                className: "meteo-sparkline-dot",
                cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                cy: yAt((segment.points[0] as HistoryPoint).windAvgMps),
                r: 1.5,
              }
            : {
                kind: "polyline" as const,
                key: segment.startedAt,
                className: "meteo-sparkline-line",
                points: segment.points
                  .map((point) =>
                    coordinate(xAt(Date.parse(point.observedAt)), yAt(point.windAvgMps)),
                  )
                  .join(" "),
              },
        )
      : runs.flatMap((segment): SparklineTracePart[] =>
          segment.points.length === 1
            ? [
                {
                  kind: "dot" as const,
                  key: segment.startedAt,
                  className: `meteo-sparkline-dot meteo-band-${speedBand(
                    (segment.points[0] as HistoryPoint).windAvgMps,
                    boundsMps,
                  )}`,
                  cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                  cy: yAt((segment.points[0] as HistoryPoint).windAvgMps),
                  r: 1.5,
                },
              ]
            : segment.points.slice(1).map((point, index) => {
                const previous = segment.points[index] as HistoryPoint;
                const band = speedBand((previous.windAvgMps + point.windAvgMps) / 2, boundsMps);
                return {
                  kind: "segment" as const,
                  key: point.observedAt,
                  className: `meteo-sparkline-segment meteo-band-${band}`,
                  x1: xAt(Date.parse(previous.observedAt)),
                  x2: xAt(Date.parse(point.observedAt)),
                  y1: yAt(previous.windAvgMps),
                  y2: yAt(point.windAvgMps),
                };
              }),
        );

  return {
    kind: "draw",
    svg: {
      ariaLabel: label,
      className: "meteo-sparkline",
      height,
      viewBox: `0 0 ${width} ${height}`,
      width,
    },
    bands: strips
      .filter((strip) => strip.points.length >= 2)
      .map((strip) => ({
        key: strip.startedAt,
        className: "meteo-sparkline-band",
        points: [
          ...strip.points.map((point) =>
            coordinate(xAt(Date.parse(point.observedAt)), yAt(point.windGustMps as number)),
          ),
          ...[...strip.points]
            .reverse()
            .map((point) =>
              coordinate(xAt(Date.parse(point.observedAt)), yAt(point.windLullMps as number)),
            ),
        ].join(" "),
      })),
    trace,
  };
}
