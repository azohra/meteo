"use client";
import { useRef } from "react";
import { resolveDisplay } from "../../index.js";
import {
  SAMPLE_STRIP_CLASS,
  readoutAriaLive,
  sampleStripGate,
  sampleStripScene,
} from "../../scene/index.js";
import { renderScene } from "./SceneTree.js";
import type { FavorableDirection, LiveSamples, SpeedUnit } from "../../index.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { useMeasuredChartWidth } from "../hooks/useMeasuredChartWidth.js";
import { usePinnedCursor } from "../lib/use-pinned-cursor.js";
import { Readout } from "./Readout.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

/* The history chart's live sibling, samples-only by design: the rolling
 * sample window in, the same frame and rows out. The host owns the live
 * subscription (useStationLive) and hands the window over; instants stay
 * ungraded — thresholds grade sustained wind, never a single sample. */
export function WindSampleStrip({
  samples,
  stationName,
  unit: unitProp,
  favorableDirections: favorableDirectionsProp,
  plotHeight,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  samples: LiveSamples | null | undefined;
  stationName: string;
  unit?: SpeedUnit;
  favorableDirections?: FavorableDirection[] | null;
  plotHeight?: number;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const { favorableDirections, formatTime, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gate = sampleStripGate(samples, words);
  const width = useMeasuredChartWidth(wrapRef, { enabled: gate.kind === "draw" });

  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  return (
    <div className={SAMPLE_STRIP_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredStrip
          favorableDirections={favorableDirections}
          formatTime={formatTime}
          plotHeight={plotHeight}
          samples={gate.samples}
          stationName={stationName}
          unit={unit}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredStrip({
  favorableDirections,
  formatTime,
  plotHeight,
  samples,
  stationName,
  unit,
  width,
  words,
}: {
  favorableDirections: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  plotHeight: number | undefined;
  samples: LiveSamples;
  stationName: string;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}) {
  const scene = sampleStripScene({
    favorableDirections,
    formatTime,
    plotHeight,
    samples,
    stationName,
    unit,
    width,
    words,
  });
  const pinned = usePinnedCursor(scene);
  const { readout, cursor } = scene.inspect(pinned.activeIndex);

  return (
    <>
      <Readout
        ariaLabel={scene.readout.ariaLabel}
        ariaLive={readoutAriaLive(pinned.previewIndex)}
        className={scene.readout.className}
        parts={readout.span}
        strong={readout.strong}
      />
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
