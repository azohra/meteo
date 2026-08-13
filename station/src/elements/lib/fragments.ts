import { directionCell } from "../../index.js";
import { freshnessBadgeSpec, windArrowSpec } from "../../scene/index.js";
import type { FreshnessStatus, Station, StationStrings } from "../../index.js";
import { EM_DASH } from "../../strings.js";
import { h, hs } from "./h.js";
import type { ElementChild } from "./h.js";

export function windArrowSvg(deg: number, size = 12): SVGElement {
  const spec = windArrowSpec(deg, size);
  const svg = hs(
    "svg",
    {
      "aria-hidden": "true",
      class: spec.className,
      height: spec.height,
      viewBox: spec.viewBox,
      width: spec.width,
    },
    hs("path", { d: spec.path.d, fill: spec.path.fill }),
  );
  (svg as SVGElement & { style: CSSStyleDeclaration }).style.transform = spec.transform;
  return svg;
}

export function directionCellNodes(
  windAvgMps: number,
  windDirectionDeg: number | null,
  words: StationStrings,
): ElementChild[] {
  const cell = directionCell(windAvgMps, windDirectionDeg);
  if (cell.kind === "calm") return [words.calm];
  if (cell.kind === "dash") return [EM_DASH];
  return [windArrowSvg(cell.deg), ` ${cell.compass} ${cell.rounded}°`];
}

export function stationNameNode(station: Station): ElementChild {
  if (station.pageUrl == null) return station.name;
  return h("a", { href: station.pageUrl, rel: "noreferrer", target: "_blank" }, station.name);
}

export function freshnessBadgeSpan(status: FreshnessStatus, words: StationStrings): HTMLElement {
  const spec = freshnessBadgeSpec(status, words);
  return h(
    "span",
    { class: spec.className, "data-freshness": spec.status },
    h("span", { "aria-hidden": "true", class: spec.dot.className }),
    spec.text,
  );
}
