"use client";
import { useId, useState } from "react";
import { resolveDisplay } from "../../index.js";
import { airMatrixScene } from "../../scene/index.js";
import { renderChildren } from "./SceneTree.js";
import type { Station } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import { requireResolved, useStationFeedContext } from "./StationFeedProvider.js";

export function AirMatrix({
  stations: stationsProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  stations?: readonly Station[];
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const stations = requireResolved(
    "AirMatrix",
    "stations",
    stationsProp ?? context?.feed?.stations,
  );
  const { formatTime, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
  });
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const scene = airMatrixScene({ formatTime, stations, words });
  if (scene == null) return null;

  return (
    <section className="meteo-air" data-expanded={expanded}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="meteo-air-trigger"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <strong className="meteo-air-title">{scene.title}</strong>
        <span className="meteo-air-summary">{scene.summary}</span>
      </button>
      <div className="meteo-air-panel" hidden={!expanded} id={panelId}>
        {renderChildren(scene.panel)}
      </div>
    </section>
  );
}
