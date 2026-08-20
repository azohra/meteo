import type { History, HistoryPoint, Station } from "../contract.js";
import {
  chartFrame,
  chartScales,
  trendRuns,
  trendSeriesPad,
  trendValueOf,
  valueScale,
} from "../geometry.js";
import type { ChartFrame, ChartScales, TrendSeries } from "../geometry.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { tickAnchor } from "./chart.js";
import type { TickAnchor } from "./chart.js";

export const TREND_CLASS = "meteo-trend";

export type TrendGate =
  | { kind: "draw"; history: History }
  | { kind: "hidden" }
  | { kind: "note"; className: string; text: string };

export function trendGate(station: Station, series: TrendSeries, words: StationStrings): TrendGate {
  if (!station.capabilities.history) return { kind: "hidden" };
  const history = station.status === "ok" ? station.history : null;
  if (history == null || history.points.length < 2) {
    return { kind: "note", className: `${TREND_CLASS} meteo-trend-na`, text: words.noHistory };
  }
  const carrying = history.points.filter((point) => trendValueOf(point, series) != null).length;
  if (carrying < 2) {
    return { kind: "note", className: `${TREND_CLASS} meteo-trend-na`, text: words.notMeasured };
  }
  return { kind: "draw", history };
}

export function trendFrame(width: number): ChartFrame {
  const core = chartFrame(width);
  return {
    ...core,
    vaneRow: core.plotBottom,
    labelRow: core.plotBottom + 22,
    height: core.plotBottom + 30,
  };
}

export type TrendSegment =
  | { kind: "dot"; className: string; startedAt: string; cx: number; cy: number; r: number }
  | { kind: "polyline"; className: string; startedAt: string; points: string };

export type TrendInspection = {
  readout: { strong: string; span: string };
  cursor: {
    line: { className: string; x1: number; x2: number; y1: number; y2: number };
    dot: { className: string; cx: number; cy: number; r: number } | null;
  } | null;
};

export type TrendScene = {
  frame: ChartFrame;
  scales: ChartScales;
  points: ReadonlyArray<HistoryPoint>;
  readout: { ariaLabel: string; className: string };
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  grid: Array<{
    key: number;
    line: { className: string; x1: number; x2: number; y1: number; y2: number };
    label: { className: string; anchor: TickAnchor; x: number; y: number; text: string };
  }>;
  segments: TrendSegment[];
  ticks: Array<{
    key: number;
    className: string;
    anchor: TickAnchor;
    x: number;
    y: number;
    text: string;
  }>;
  hit: { className: string; fill: string; height: number; width: number; x: number; y: number };
  inspect: (activeIndex: number | null) => TrendInspection;
};

export function trendScene(input: {
  formatTime: FormatTime;
  history: History;
  series: TrendSeries;
  stationName: string;
  width: number;
  words: StationStrings;
}): TrendScene {
  const { formatTime, history, series, stationName, width, words } = input;
  const points = history.points;
  const frame = trendFrame(width);
  const scales = chartScales(points, frame);

  const scale = valueScale(
    points.map((point) => trendValueOf(point, series)),
    frame,
    { paddingMin: trendSeriesPad(series) },
  );

  const segments = trendRuns(points, series, history.periodMinutes).map((run): TrendSegment => {
    const coords = run.samples.map(([ms, value]) => [scales.xAtMs(ms), scale.yAt(value)] as const);
    const only = coords[0];
    return coords.length === 1 && only != null
      ? {
          kind: "dot",
          className: "meteo-trend-dot",
          startedAt: run.startedAt,
          cx: only[0],
          cy: only[1],
          r: 2.5,
        }
      : {
          kind: "polyline",
          className: "meteo-trend-line",
          startedAt: run.startedAt,
          points: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
        };
  });

  const seriesLabel = series === "temperature" ? words.trendTemperature : words.trendPressure;
  const unitWord = series === "temperature" ? words.degC : words.air.unitHpa;

  const grid = [0, 0.5, 1].map((fraction) => {
    const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
    return {
      key: fraction,
      line: { className: "meteo-grid-line", x1: frame.left, x2: frame.right, y1: gridY, y2: gridY },
      label: {
        className: "meteo-grid-label",
        anchor: "end" as TickAnchor,
        x: frame.left - 6,
        y: gridY + 5,
        text: String(Math.round(scale.min + fraction * (scale.max - scale.min))),
      },
    };
  });

  /* Floor 2 time labels (the ends), ceiling 5 — what the width seats. */
  const tickCount = Math.max(2, Math.min(5, Math.floor((frame.right - frame.left) / 76)));
  const ticks = Array.from({ length: tickCount }, (_, at) => at / (tickCount - 1)).map(
    (fraction, index) => {
      const timeMs = scales.startMs + fraction * scales.durationMs;
      return {
        key: index,
        className: "meteo-tick",
        anchor: tickAnchor(index, 4),
        x: scales.xAtMs(timeMs),
        y: frame.labelRow,
        text: formatTime(new Date(timeMs)),
      };
    },
  );

  return {
    frame,
    scales,
    points,
    readout: { ariaLabel: words.aria.readout(stationName), className: "meteo-trend-readout" },
    svg: {
      ariaLabel: words.aria.trend(stationName, seriesLabel),
      className: "meteo-trend-svg",
      height: frame.height,
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      width: frame.width,
    },
    grid,
    segments,
    ticks,
    hit: {
      className: "meteo-hit",
      fill: "transparent",
      height: frame.height,
      width: frame.width,
      x: 0,
      y: 0,
    },
    inspect: (activeIndex) => {
      const active = activeIndex == null ? undefined : points[activeIndex];
      if (active == null) {
        return {
          readout: {
            strong: `${formatTime(new Date(scales.startMs))}–${formatTime(new Date(scales.endMs))}`,
            span: words.inspectHint,
          },
          cursor: null,
        };
      }
      const activeValue = trendValueOf(active, series);
      const x = scales.xAt(active.observedAt);
      return {
        readout: {
          strong: formatTime(new Date(active.observedAt)),
          span: `${seriesLabel} ${activeValue == null ? EM_DASH : `${activeValue.toFixed(1)} ${unitWord}`}`,
        },
        cursor: {
          line: {
            className: "meteo-cursor",
            x1: x,
            x2: x,
            y1: frame.plotTop,
            y2: frame.plotBottom + 4,
          },
          dot:
            activeValue == null
              ? null
              : { className: "meteo-cursor-dot", cx: x, cy: scale.yAt(activeValue), r: 3 },
        },
      };
    },
  };
}
