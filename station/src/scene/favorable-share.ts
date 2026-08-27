import type { HistoryPoint, Station } from "../contract.js";
import { favorableShare } from "../geometry.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { el, type SceneNode } from "./node.js";

export const FAVORABLE_SHARE_CLASS = "meteo-favorable-share";

export function favorableShareSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): ReadonlyArray<HistoryPoint> {
  return points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
}

/* Null without arcs — favorable is a judgment the consumer must supply, so
 * no arcs means no verdict surface at all, never a fabricated 0%. Calm-only
 * history has no share either; the note says so instead of inventing one. */
export function favorableShareScene(input: {
  favorableDirections: ReadonlyArray<FavorableDirection> | undefined;
  source: ReadonlyArray<HistoryPoint>;
  stationName: string | undefined;
  words: StationStrings;
}): SceneNode | null {
  const { favorableDirections, source, stationName, words } = input;
  const note = (text: string) =>
    el("div", { class: `${FAVORABLE_SHARE_CLASS} meteo-favorable-share-na`, role: "note" }, text);

  if (favorableDirections == null || favorableDirections.length === 0) return null;
  if (source.length === 0) return note(words.noHistory);
  const share = favorableShare(source, favorableDirections);
  if (share == null) return note(words.calm);

  return el(
    "div",
    {
      "aria-label": stationName == null ? undefined : words.aria.favorableShare(stationName),
      class: FAVORABLE_SHARE_CLASS,
    },
    el("span", { class: "meteo-favorable-share-label" }, words.favorableLabel),
    " ",
    el(
      "span",
      { class: "meteo-favorable-share-value" },
      words.percentShare(Math.round(share * 100)),
    ),
  );
}
