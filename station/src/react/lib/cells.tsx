"use client";
import { directionCell } from "../../index.js";
import { EM_DASH } from "../../strings.js";
import type { Station, StationStrings } from "../../index.js";
import { WindArrow } from "../components/WindArrow.js";

export function DirectionCell({
  windAvgMps,
  windDirectionDeg,
  words,
}: {
  windAvgMps: number;
  windDirectionDeg: number | null;
  words: StationStrings;
}) {
  const cell = directionCell(windAvgMps, windDirectionDeg);
  if (cell.kind === "calm") return <>{words.calm}</>;
  if (cell.kind === "dash") return <>{EM_DASH}</>;
  return (
    <>
      <WindArrow deg={cell.deg} /> {cell.compass} {cell.rounded}°
    </>
  );
}

export function StationNameLink({ station }: { station: Station }) {
  if (station.pageUrl == null) return <>{station.name}</>;
  return (
    <a href={station.pageUrl} rel="noreferrer" target="_blank">
      {station.name}
    </a>
  );
}
