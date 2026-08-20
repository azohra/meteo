import { defineMeteoElements } from "@azohra/meteo.station/elements";
import type { StationFeedElement } from "@azohra/meteo.station/elements";
import { buildExhibitFeed } from "./station-exhibit";

let wired = false;

export function wireStationExhibits(): void {
  if (wired) return;
  wired = true;

  const feeds = [...document.querySelectorAll<StationFeedElement>("meteo-station-feed")];
  const publish = () => {
    const now = Date.now();
    for (const feed of feeds) {
      feed.feed = buildExhibitFeed(now);
      feed.receivedAtMs = now;
    }
  };
  publish();
  setInterval(publish, 5_000);

  /* Define the tags only after the feed is set: an element that upgrades with no feed throws. */
  defineMeteoElements();
}
