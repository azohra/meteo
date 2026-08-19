import type { HistoryPoint, Station } from "../contract.js";
import { favorableShare } from "../geometry.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";

export const FAVORABLE_SHARE_CLASS = "meteo-favorable-share";

export function favorableShareSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): ReadonlyArray<HistoryPoint> {
  return points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
}

export type FavorableShareGate =
  | { kind: "draw"; share: number }
  | { kind: "hidden" }
  | { kind: "note"; className: string; text: string };

/* hidden without arcs — favorable is a judgment the consumer must supply, so
 * no arcs means no verdict surface at all, never a fabricated 0%. Calm-only
 * history has no share either; the note says so instead of inventing one. */
export function favorableShareGate(
  source: ReadonlyArray<HistoryPoint>,
  favorableDirections: ReadonlyArray<FavorableDirection> | undefined,
  words: StationStrings,
): FavorableShareGate {
  if (favorableDirections == null || favorableDirections.length === 0) return { kind: "hidden" };
  if (source.length === 0) {
    return {
      kind: "note",
      className: `${FAVORABLE_SHARE_CLASS} meteo-favorable-share-na`,
      text: words.noHistory,
    };
  }
  const share = favorableShare(source, favorableDirections);
  if (share == null) {
    return {
      kind: "note",
      className: `${FAVORABLE_SHARE_CLASS} meteo-favorable-share-na`,
      text: words.calm,
    };
  }
  return { kind: "draw", share };
}

export type FavorableShareScene = {
  className: string;
  ariaLabel: string | undefined;
  label: { className: string; text: string };
  value: { className: string; text: string };
};

export function favorableShareScene(input: {
  share: number;
  stationName: string | undefined;
  words: StationStrings;
}): FavorableShareScene {
  const { share, stationName, words } = input;
  return {
    className: FAVORABLE_SHARE_CLASS,
    ariaLabel: stationName == null ? undefined : words.aria.favorableShare(stationName),
    label: { className: "meteo-favorable-share-label", text: words.favorableLabel },
    value: {
      className: "meteo-favorable-share-value",
      text: words.percentShare(Math.round(share * 100)),
    },
  };
}
