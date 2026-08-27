import type { HistoryPoint, Station } from "../contract.js";
import { el, keyed, type SceneNode } from "./node.js";
import { thresholdsToMps } from "../derive.js";
import type { SpeedThresholds } from "../derive.js";
import { speedBand } from "../geometry.js";
import { bandStrips, historyRuns, sparklineScale } from "../instruments.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function sparklineScene(input: {
  height: number;
  showBand: boolean;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  width: number;
  words: StationStrings;
}): SceneNode {
  const { height, showBand, station, thresholds, width, words } = input;
  const label = words.aria.sparkline(station.name);

  const history = station.status === "ok" ? station.history : null;
  const drawable = station.capabilities.history && history != null && history.points.length >= 2;

  if (!drawable || history == null) {
    return {
      ...el(
        "span",
        { "aria-label": label, class: "meteo-sparkline meteo-sparkline-na", role: "img" },
        EM_DASH,
      ),
      style: { height: `${height}px`, width: `${width}px` },
    };
  }

  const points = history.points;
  const { xAt, yAt } = sparklineScale(points, width, height);
  const runs = historyRuns(points, history.periodMinutes);
  const strips = showBand ? bandStrips(runs) : [];

  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  const trace: SceneNode[] =
    boundsMps == null
      ? runs.map((segment) =>
          segment.points.length === 1
            ? keyed(segment.startedAt, "circle", {
                class: "meteo-sparkline-dot",
                cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                cy: yAt((segment.points[0] as HistoryPoint).windAvgMps),
                r: 1.5,
              })
            : keyed(segment.startedAt, "polyline", {
                class: "meteo-sparkline-line",
                points: segment.points
                  .map((point) =>
                    coordinate(xAt(Date.parse(point.observedAt)), yAt(point.windAvgMps)),
                  )
                  .join(" "),
              }),
        )
      : runs.flatMap((segment): SceneNode[] =>
          segment.points.length === 1
            ? [
                keyed(segment.startedAt, "circle", {
                  class: `meteo-sparkline-dot meteo-band-${speedBand(
                    (segment.points[0] as HistoryPoint).windAvgMps,
                    boundsMps,
                  )}`,
                  cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                  cy: yAt((segment.points[0] as HistoryPoint).windAvgMps),
                  r: 1.5,
                }),
              ]
            : segment.points.slice(1).map((point, index) => {
                const previous = segment.points[index] as HistoryPoint;
                const band = speedBand((previous.windAvgMps + point.windAvgMps) / 2, boundsMps);
                return keyed(point.observedAt, "line", {
                  class: `meteo-sparkline-segment meteo-band-${band}`,
                  x1: xAt(Date.parse(previous.observedAt)),
                  x2: xAt(Date.parse(point.observedAt)),
                  y1: yAt(previous.windAvgMps),
                  y2: yAt(point.windAvgMps),
                });
              }),
        );

  return el(
    "svg",
    {
      "aria-label": label,
      class: "meteo-sparkline",
      height,
      role: "img",
      viewBox: `0 0 ${width} ${height}`,
      width,
    },
    strips
      .filter((strip) => strip.points.length >= 2)
      .map((strip) =>
        keyed(strip.startedAt, "polygon", {
          class: "meteo-sparkline-band",
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
        }),
      ),
    trace,
  );
}
