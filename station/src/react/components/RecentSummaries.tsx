"use client";
import { resolveDisplay } from "../../index.js";
import { recentSummariesGate, recentSummariesScene } from "../../scene/index.js";
import type { FavorableDirection, RecentSummary, Station } from "../../index.js";
import type { SpeedUnit, StationStringOverrides } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

/** The source's own step digests as summary panels: per window, the
 * average, gust, and lull beside one small arrow per step. */
export function RecentSummaries({
  summaries,
  station: stationProp,
  stationId,
  favorableDirections: favorableDirectionsProp,
  unit: unitProp,
  strings: stringsProp,
}: {
  summaries?: RecentSummary[] | null;
  station?: Station;
  stationId?: string;
  favorableDirections?: FavorableDirection[] | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ??
    (summaries == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const gate = recentSummariesGate(station, summaries, words);
  if (gate.kind === "hidden") return null;
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  const scene = recentSummariesScene({
    favorableDirections,
    stationName: station?.name,
    summaries: gate.summaries,
    unit,
    words,
  });
  return (
    <div aria-label={scene.ariaLabel} className={scene.className}>
      {scene.panels.map((panel) => (
        <section className={panel.className} key={panel.key}>
          <h4 className={panel.label.className}>{panel.label.text}</h4>
          <div className="meteo-recent-summary-ghosts">
            {panel.ghosts.map((ghost) => (
              <span className={ghost.className} key={ghost.key}>
                <WindArrow deg={ghost.deg} />
              </span>
            ))}
          </div>
          <dl className="meteo-recent-summary-stats">
            {panel.stats.map((stat) => (
              <div className={stat.className} key={stat.key}>
                <dt className="meteo-microlabel">{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
