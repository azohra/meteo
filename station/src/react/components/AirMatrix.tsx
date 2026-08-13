"use client";
import { useId, useState } from "react";
import { resolveDisplay } from "../../index.js";
import { airMatrixScene } from "../../scene/index.js";
import type { Station } from "../../index.js";
import type { AirMatrixRow } from "../../scene/index.js";
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

  const rowTemplate = { gridTemplateColumns: scene.matrix.gridTemplateColumns } as const;

  return (
    <section className={scene.className} data-expanded={expanded}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className={scene.trigger.className}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <strong className={scene.trigger.title.className}>{scene.trigger.title.text}</strong>
        <span className={scene.trigger.summary.className}>{scene.trigger.summary.text}</span>
      </button>
      <div className={scene.panelClassName} hidden={!expanded} id={panelId}>
        <div aria-label={scene.matrix.ariaLabel} className={scene.matrix.className} role="table">
          <div className={scene.matrix.head.className} role="row" style={rowTemplate}>
            <span className={scene.matrix.head.corner.className} role="columnheader" />
            {scene.matrix.head.columns.map((column) => (
              <span
                className={scene.matrix.head.columnClassName}
                key={column.key}
                role="columnheader"
              >
                {column.text}
              </span>
            ))}
          </div>
          {scene.matrix.rows.map((row: AirMatrixRow) => (
            <div className={row.className} key={row.key} role="row" style={rowTemplate}>
              <span className={row.labelClassName} role="rowheader">
                {row.label}
                <small>{row.unit}</small>
              </span>
              {row.cells.map((cell) => (
                <span className={cell.className} key={cell.key} role="cell">
                  {cell.text}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className={scene.note.className}>{scene.note.text}</p>
      </div>
    </section>
  );
}
