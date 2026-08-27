"use client";
import { useEffect, useId, useRef, useState } from "react";
import { resolveDisplay } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  CLIMATOLOGY_PATTERN_CLASS,
  hasClimatology,
  climatologyPatternScene,
  measuredChartWidth,
} from "../../scene/index.js";
import { renderChildren } from "./SceneTree.js";
import type { FavorableDirection, SpeedThresholds, StationClimatology } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

/** The cube's typical day through the daily-pattern drawing, month-filtered
 * client-side. The host owns the document and the filters. */
export function ClimatologyDailyPattern({
  document,
  months,
  favorableDirections: favorableDirectionsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  plotHeight,
  stationName,
  strings: stringsProp,
}: {
  document: StationClimatology | null | undefined;
  months?: ReadonlyArray<number>;
  favorableDirections?: FavorableDirection[] | null;
  thresholds?: SpeedThresholds | null;
  unit?: "kmh" | "knots" | "mph" | "mps";
  plotHeight?: number;
  stationName?: string;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const { favorableDirections, thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const hatchId = `meteo-climatology-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const drawable = hasClimatology(document);

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

  if (!drawable) {
    return renderChildren(
      climatologyPatternScene({
        document,
        hatchId,
        plotHeight,
        stationName,
        thresholds,
        unit,
        width: 0,
        words,
      }),
    );
  }

  return (
    <div className={CLIMATOLOGY_PATTERN_CLASS} ref={wrapRef}>
      {width != null &&
        renderChildren(
          climatologyPatternScene({
            document,
            favorableDirections,
            filters: { months },
            hatchId,
            plotHeight,
            stationName,
            thresholds,
            unit,
            width,
            words,
          }),
        )}
    </div>
  );
}
