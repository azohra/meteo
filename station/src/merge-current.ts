import type { Reading, StationCurrent, StationFeed } from "./contract.js";

export type MergeResult = { feed: StationFeed; merged: boolean };

function preserveOmitted(incoming: Reading, prior: Reading | null): Reading {
  if (prior == null) return incoming;
  return {
    ...incoming,
    temperatureC: incoming.temperatureC ?? prior.temperatureC,
    windChillC: incoming.windChillC ?? prior.windChillC,
    conditions: incoming.conditions ?? prior.conditions,
  };
}

export function mergeCurrent(feed: StationFeed, current: StationCurrent): MergeResult {
  const incoming = current.station;
  if (incoming.status !== "ok") return { feed, merged: false };
  if (!feed.stations.some((station) => station.id === incoming.id)) {
    return { feed, merged: false };
  }
  return {
    feed: {
      ...feed,
      servedAt: current.servedAt,
      stations: feed.stations.map((station) => {
        if (station.id !== incoming.id) return station;
        const prior = station.status === "ok" ? station : null;
        return {
          ...incoming,
          reading: preserveOmitted(incoming.reading, prior?.reading ?? null),
          history: prior?.history ?? null,
          /* A current that carries no summaries (a records-road fallback)
           * never wipes fresher live-folded blocks; one that does carries
           * the whole block — provenance is never mixed. */
          recentSummaries: incoming.recentSummaries ?? prior?.recentSummaries ?? null,
        };
      }),
    },
    merged: true,
  };
}

export function foldCurrent(
  feed: StationFeed | null,
  feedReceivedAtMs: number | null,
  current: StationCurrent | null,
  currentReceivedAtMs: number | null,
): { feed: StationFeed | null; receivedAtMs: number | null } {
  if (feed == null) return { feed: null, receivedAtMs: null };
  if (current == null) return { feed, receivedAtMs: feedReceivedAtMs };
  const result = mergeCurrent(feed, current);
  return {
    feed: result.feed,
    receivedAtMs: result.merged ? currentReceivedAtMs : feedReceivedAtMs,
  };
}
