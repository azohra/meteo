"use client";
import { useEffect, useRef, useState } from "react";
import { resolveDisplay } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  TREND_CLASS,
  measuredChartWidth,
  readoutAriaLive,
  trendGate,
  trendScene,
} from "../../scene/index.js";
import { renderScene } from "./SceneTree.js";
import type { History, Station } from "../../index.js";
import type { TrendSeries } from "../../geometry.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { usePinnedCursor } from "../lib/use-pinned-cursor.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function TrendChart({
  station: stationProp,
  stationId,
  series,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  series: TrendSeries;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "TrendChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { formatTime, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const gate = trendGate(station, series, words);
  const drawable = gate.kind === "draw";

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(measuredChartWidth(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawable]);

  if (gate.kind === "hidden") return null;
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  return (
    <div className={TREND_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredTrend
          formatTime={formatTime}
          history={gate.history}
          series={series}
          stationName={station.name}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredTrend({
  formatTime,
  history,
  series,
  stationName,
  width,
  words,
}: {
  formatTime: FormatTime;
  history: History;
  series: TrendSeries;
  stationName: string;
  width: number;
  words: StationStrings;
}) {
  const scene = trendScene({ formatTime, history, series, stationName, width, words });
  const pinned = usePinnedCursor(scene);
  const { readout, cursor } = scene.inspect(pinned.activeIndex);

  return (
    <>
      <output
        aria-label={scene.readout.ariaLabel}
        aria-live={readoutAriaLive(pinned.previewIndex)}
        className={scene.readout.className}
      >
        <strong>{readout.strong}</strong>
        <span>{readout.span}</span>
      </output>
      {renderScene(
        scene.draw(cursor, {
          onClick: pinned.handleClick,
          onPointerLeave: pinned.handlePointerLeave,
          onPointerMove: pinned.handlePointerMove,
        }),
      )}
    </>
  );
}
