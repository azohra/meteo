import { el, escapeXml, text } from "../xml.js";
import type { CompareBoardRow, CompareBoardScene, CompareBoardVote } from "./types.js";
import { DEFAULT_BOARD_STYLESHEET } from "./theme.js";

export interface RenderCompareBoardSvgOptions {
  /** Stylesheet embedded in a <style> block; defaults to DEFAULT_BOARD_STYLESHEET, and null omits it. */
  stylesheet?: string | null;
  /** Prefix for generated element ids — give each board on a page its own so pattern ids cannot collide. Default "meteo-board". */
  idPrefix?: string;
}

/** Short numeric attribute value (two decimals, no trailing zeros). */
function sh(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** m/s to one decimal — the board never converts units for display. */
function mps(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** The cited instant's local clock, "HH:MM". */
function clock(at: { local: string }): string {
  return at.local.slice(11);
}

/* The lane's fixed vertical anatomy inside a row (row-relative y). */
const LANE_TOP = 8;
const LANE_H = 34;
const BAR_TOP = 12;
const BAR_H = 10;
const LIMIT_TOPS = { surfaceWind: 25, gust: 30, bandWind: 35 } as const;
const LIMIT_H = 4;

const COLS = {
  pad: 12,
  model: { x: 12, w: 132 },
  lane: { x: 152, w: 260 },
  launch: { x: 424, w: 140 },
  gust: { x: 576, w: 68 },
  aloft: { x: 656, w: 100 },
  top: { x: 768, w: 88 },
  storms: { x: 868, w: 132 },
} as const;
const WIDTH = COLS.storms.x + COLS.storms.w + COLS.pad;
const HEAD_H = 30;
const ROW_H = 52;

const QUANTITY_WORDS = {
  surfaceWind: "surface wind",
  gust: "gust",
  bandWind: "band wind",
} as const;

function voteWords(vote: CompareBoardVote): string | null {
  switch (vote.kind) {
    case "window":
      return null;
    case "quiet":
      return `quiet — ${vote.failed.join(", ")}`;
    case "abstained":
      return vote.reason === "outOfHorizon" ? "no call — out of horizon" : "no call — partial day";
    case "benched":
      return `not counted — terrain ${sh(vote.deltaM)} m`;
  }
}

/** The row's full text equivalent — every mark on the lane, in words. */
function rowWords(row: CompareBoardRow): string {
  const parts: string[] = [];
  const note = voteWords(row.vote);
  if (note) parts.push(note);
  for (const window of row.windows) {
    /* Clip flags keep a horizon from reading as a forecast: an edge at
       the document's own first/last hour is a data boundary. */
    const opens = window.clippedAtStart
      ? `open since at least ${clock(window.start)}`
      : `opens ${clock(window.start)}`;
    const closes = window.clippedAtEnd
      ? `still open at ${clock(window.end)}`
      : `closes ${clock(window.end)}`;
    parts.push(`window ${opens}, ${closes}`);
  }
  for (const exceedance of row.exceedances) {
    for (const run of exceedance.runs) {
      parts.push(
        `${QUANTITY_WORDS[exceedance.quantity]} at or above ${mps(exceedance.thresholdMps)} m/s ${clock(run.start)}–${clock(run.end)} (peak ${mps(run.peakMps)})`,
      );
    }
  }
  if (row.storms?.capBreak) {
    const capBreak = row.storms.capBreak;
    parts.push(
      capBreak.kind === "between"
        ? `cap breaks between ${clock(capBreak.start)} and ${clock(capBreak.end)}`
        : capBreak.kind === "alreadyOpenAt"
          ? `cap already open at ${clock(capBreak.start)}`
          : `cap breaks ${clock(capBreak.start)}`,
    );
  }
  if (row.rainStart) parts.push(`rain from ${clock(row.rainStart.at)}`);
  return parts.join(" · ");
}

function laneMarks(row: CompareBoardRow, rowY: number, laneX: (x: number) => number): string {
  const parts: string[] = [];
  for (const window of row.windows) {
    const x0 = laneX(window.x0);
    const x1 = laneX(window.x1);
    parts.push(
      el("rect", {
        x: sh(x0),
        y: rowY + BAR_TOP,
        width: sh(Math.max(1, x1 - x0)),
        height: BAR_H,
        class: "meteo-board-window",
      }),
    );
    /* A clipped edge is a data boundary, not an opening or a decay — it
       wears an open chevron instead of ending like a forecast edge. */
    const chevron = (x: number, direction: 1 | -1) =>
      el("path", {
        d: `M${sh(x + 4 * direction)} ${rowY + BAR_TOP - 2} L${sh(x)} ${rowY + BAR_TOP + BAR_H / 2} L${sh(x + 4 * direction)} ${rowY + BAR_TOP + BAR_H + 2}`,
        class: "meteo-board-window-clip",
      });
    if (window.clippedAtStart) parts.push(chevron(x0 - 2, 1));
    if (window.clippedAtEnd) parts.push(chevron(x1 + 2, -1));
  }
  for (const exceedance of row.exceedances) {
    const top = rowY + LIMIT_TOPS[exceedance.quantity];
    for (const run of exceedance.runs) {
      const x0 = laneX(run.x0);
      const x1 = laneX(run.x1);
      parts.push(
        el("rect", {
          x: sh(x0),
          y: top,
          width: sh(Math.max(1, x1 - x0)),
          height: LIMIT_H,
          class: `meteo-board-limit meteo-board-limit-${exceedance.quantity}`,
        }),
      );
    }
  }
  if (row.storms?.capBreak) {
    const capBreak = row.storms.capBreak;
    const x0 = laneX(capBreak.x0);
    const x1 = laneX(capBreak.x1);
    if (capBreak.kind === "between") {
      parts.push(
        el("rect", {
          x: sh(x0),
          y: rowY + LANE_TOP,
          width: sh(Math.max(1, x1 - x0)),
          height: 4,
          class: "meteo-board-cap-span",
        }),
      );
    }
    parts.push(
      el("path", {
        d: `M${sh(x0)} ${rowY + LANE_TOP} l3.5 0 l-2 4 l3 0 l-5 6 l1.5 -4.5 l-3 0 z`,
        class: "meteo-board-cap",
      }),
    );
  }
  if (row.rainStart) {
    const x = laneX(row.rainStart.x);
    parts.push(
      el("path", {
        d: `M${sh(x)} ${rowY + LANE_TOP + LANE_H - 8} l2.4 4 a2.8 2.8 0 1 1 -4.8 0 z`,
        class: "meteo-board-rain",
      }),
    );
  }
  return parts.join("");
}

interface Cell {
  lines: string[];
  class: "meteo-board-cell" | "meteo-board-cell-blank" | "meteo-board-cell-over";
  title?: string;
}

const BLANK: Cell = { lines: ["—"], class: "meteo-board-cell-blank", title: "no statement" };

function launchCell(row: CompareBoardRow): Cell {
  if (!row.launch) return BLANK;
  const sample = (endpoint: { directionDeg: number | null; speedMps: number }) =>
    endpoint.directionDeg === null
      ? `· ${mps(endpoint.speedMps)}`
      : `${Math.round(endpoint.directionDeg)}° ${mps(endpoint.speedMps)}`;
  return {
    lines: [
      `${sample(row.launch.start)} → ${sample(row.launch.end)} m/s`,
      row.launch.netVeerDeg === null ? "" : `veer ${Math.round(row.launch.netVeerDeg)}°`,
    ].filter(Boolean),
    class: row.overCeiling.surfaceWind ? "meteo-board-cell-over" : "meteo-board-cell",
    title: `surface wind, window open ${clock(row.launch.window.start)} → close ${clock(
      row.launch.window.end,
    )}; at peak lift ${sample(row.launch.peakLift)} m/s (${clock(row.launch.peakLift.at.at)}); a "·" direction sits under the analysis's ${mps(row.launch.directionFloorMps)} m/s direction floor${
      row.overCeiling.surfaceWind
        ? "; hours at or above the caller's surface ceiling are barred on the lane"
        : ""
    }`,
  };
}

function gustCell(row: CompareBoardRow): Cell {
  if (!row.gust) return BLANK;
  const classWord =
    row.gust.semantics === "hourMax" ? "hr-max" : row.gust.semantics === "instant" ? "inst" : "";
  return {
    lines: [`${mps(row.gust.gustMps)}${classWord ? ` ${classWord}` : ""}`],
    class: row.overCeiling.gust ? "meteo-board-cell-over" : "meteo-board-cell",
    title: `strongest gust ${row.gust.scope === "duringWindow" ? "during the window" : "in the day"}, ${clock(row.gust.at.at)} — reporting class ${
      row.gust.semantics ?? "undeclared"
    }; hour-max and instantaneous gusts are different objects and never compare`,
  };
}

function aloftCell(row: CompareBoardRow): Cell {
  if (!row.aloft) return BLANK;
  return {
    lines: [`${mps(row.aloft.windMps)} @ ${Math.round(row.aloft.heightM)} m`],
    class: row.overCeiling.bandWind ? "meteo-board-cell-over" : "meteo-board-cell",
    title: `strongest wind in the climb band ${
      row.aloft.scope === "duringWindow" ? "during the window" : "in the day"
    }, ${clock(row.aloft.at.at)}${
      row.aloft.directionDeg === null ? "" : `, from ${Math.round(row.aloft.directionDeg)}°`
    }`,
  };
}

function topCell(row: CompareBoardRow): Cell {
  if (!row.top) return BLANK;
  return {
    lines: [
      `${Math.round(row.top.liftTopM)} m`,
      row.top.cloudCapped === true ? "cloud base" : "",
    ].filter(Boolean),
    class: "meteo-board-cell",
    title: `peak usable-lift top, ${clock(row.top.at.at)}${
      row.top.aboveLaunchM === null ? "" : ` — ${Math.round(row.top.aboveLaunchM)} m above launch`
    }${
      row.top.cloudCapped === true
        ? "; cloud base sets the top at the cited hour — the number IS cloud base"
        : row.top.cloudCapped === false
          ? "; updraft decay, not cloud, sets the top at the cited hour"
          : ""
    }`,
  };
}

function stormsCell(row: CompareBoardRow): Cell {
  const storms = row.storms;
  if (!storms) return BLANK;
  const cape = `CAPE ${Math.round(storms.peakCapeJkg)} J/kg`;
  let headline: string;
  switch (storms.verdict) {
    case "capBreaks": {
      const capBreak = storms.capBreak!;
      headline =
        capBreak.kind === "between"
          ? `breaks ${clock(capBreak.start)}–${clock(capBreak.end)}`
          : capBreak.kind === "alreadyOpenAt"
            ? `open from ${clock(capBreak.start)}`
            : `breaks ${clock(capBreak.start)}`;
      break;
    }
    case "cappedAllDay":
      headline = storms.cadence === "multiHour" ? "no break at the steps" : "capped all day";
      break;
    case "openButWeak":
      headline = "open, little energy";
      break;
    case "noInstability":
      headline = "no instability";
      break;
    case "capUnjudgeable":
      headline = "cap unreadable";
      break;
  }
  return {
    lines: [headline, cape],
    class: "meteo-board-cell",
    title: `${storms.source} verdict ${storms.verdict}${
      storms.source === "convectiveDay" ? " — this model publishes no CIN" : ""
    }; CAPE is model-specific and never compares across rows${
      storms.precipStartsAt ? `; rain from ${clock(storms.precipStartsAt.at)}` : ""
    }${storms.noPrecipAboveThreshold ? "; no rain above the stated floor" : ""}`,
  };
}

function cellText(cell: Cell, x: number, rowY: number): string {
  const body = cell.lines
    .map((line, index) => text({ x, y: rowY + 24 + index * 13, class: cell.class }, line))
    .join("");
  return cell.title ? el("g", {}, el("title", {}, escapeXml(cell.title)) + body) : body;
}

/**
 * Serializes a compare-board scene to a self-contained SVG document —
 * the reference rendering, sized for goldens and documentation. Colour
 * is never the only encoding: windows, exceedance bars, cap marks, and
 * rain drops occupy distinct lane positions with distinct shapes,
 * clipped edges wear open chevrons, and every row and cell carries its
 * text equivalent as a <title>.
 */
export function renderCompareBoardSvg(
  scene: CompareBoardScene,
  options: RenderCompareBoardSvgOptions = {},
): string {
  const idPrefix = options.idPrefix ?? "meteo-board";
  const stylesheet =
    options.stylesheet === undefined ? DEFAULT_BOARD_STYLESHEET : options.stylesheet;
  const height = HEAD_H + scene.rows.length * ROW_H + COLS.pad;
  const laneX = (fraction: number) => COLS.lane.x + fraction * COLS.lane.w;

  const body: string[] = [];
  const titleId = `${idPrefix}-title`;
  body.push(
    el(
      "title",
      { id: titleId },
      escapeXml(
        `Compare board — ${scene.dateKey} (${scene.timeZone}), ${scene.rows.length} member${scene.rows.length === 1 ? "" : "s"}`,
      ),
    ),
  );
  if (stylesheet) body.push(el("style", {}, `\n${stylesheet}\n`));

  body.push(
    el("rect", {
      x: 0.5,
      y: 0.5,
      width: WIDTH - 1,
      height: height - 1,
      class: "meteo-board-frame",
    }),
  );

  /* Header: column names with units, and the axis hours over the lane. */
  const headY = 19;
  body.push(
    text({ x: COLS.model.x, y: headY, class: "meteo-board-head" }, "MODEL"),
    text({ x: COLS.launch.x, y: headY, class: "meteo-board-head" }, "LAUNCH m/s"),
    text({ x: COLS.gust.x, y: headY, class: "meteo-board-head" }, "GUST m/s"),
    text({ x: COLS.aloft.x, y: headY, class: "meteo-board-head" }, "ALOFT m/s"),
    text({ x: COLS.top.x, y: headY, class: "meteo-board-head" }, "TOP m"),
    text({ x: COLS.storms.x, y: headY, class: "meteo-board-head" }, "STORMS"),
  );
  for (const tick of scene.axis.ticks) {
    body.push(
      text(
        {
          x: sh(laneX(tick.x)),
          y: headY,
          "text-anchor": "middle",
          class: "meteo-board-hour",
        },
        String(tick.hour).padStart(2, "0"),
      ),
    );
  }

  scene.rows.forEach((row, index) => {
    const rowY = HEAD_H + index * ROW_H;
    const parts: string[] = [];
    const words = rowWords(row);
    if (words) parts.push(el("title", {}, escapeXml(words)));

    parts.push(text({ x: COLS.model.x, y: rowY + 20, class: "meteo-board-model" }, row.model));
    const noteLines: Array<{ content: string; class: string }> = [];
    if (row.kind === "ensemble") noteLines.push({ content: "ENSEMBLE", class: "meteo-board-kind" });
    const note = voteWords(row.vote);
    if (note) noteLines.push({ content: note, class: "meteo-board-note" });
    noteLines.forEach((line, lineIndex) => {
      parts.push(
        text({ x: COLS.model.x, y: rowY + 32 + lineIndex * 11, class: line.class }, line.content),
      );
    });

    parts.push(
      el("rect", {
        x: COLS.lane.x,
        y: rowY + LANE_TOP,
        width: COLS.lane.w,
        height: LANE_H,
        class: "meteo-board-lane",
      }),
    );
    for (const tick of scene.axis.ticks) {
      parts.push(
        el("line", {
          x1: sh(laneX(tick.x)),
          y1: rowY + LANE_TOP,
          x2: sh(laneX(tick.x)),
          y2: rowY + LANE_TOP + LANE_H,
          class: "meteo-board-tick",
        }),
      );
    }
    parts.push(laneMarks(row, rowY, laneX));

    parts.push(cellText(launchCell(row), COLS.launch.x, rowY));
    parts.push(cellText(gustCell(row), COLS.gust.x, rowY));
    parts.push(cellText(aloftCell(row), COLS.aloft.x, rowY));
    parts.push(cellText(topCell(row), COLS.top.x, rowY));
    parts.push(cellText(stormsCell(row), COLS.storms.x, rowY));

    body.push(el("g", { class: "meteo-board-row" }, parts.join("")));
  });

  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${WIDTH} ${height}`,
      width: WIDTH,
      height,
      role: "img",
      "aria-labelledby": titleId,
      class: "meteo-board",
    },
    body.join(""),
  );
}
