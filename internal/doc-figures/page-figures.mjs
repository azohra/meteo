import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACCENT,
  ACCENT_INK,
  ACCENT_STRONG,
  CODE_BG,
  codeSegments,
  DISPLAY,
  HALO,
  INK,
  INK_MUTE,
  INK_SOFT,
  MONO,
  paper,
  placeChart,
  round,
  RULE,
  RULE_STRONG,
  STRIP_BG,
  SURFACE,
  SURFACE_ACCENT,
  SURFACE_SUNKEN,
  t,
} from "./compose-helpers.mjs";
import { measureText, wrapText } from "./fonts.mjs";

const FRAME_MARGIN = 30;

function wrapped(x, y, lines, o, lineHeight) {
  return lines.map((line, index) => t(x, y + index * lineHeight, line, o)).join("\n  ");
}

function frame({ id, title, lesson, caption, units, description, bodyWidth, bodyHeight, body }) {
  const width = bodyWidth + FRAME_MARGIN * 2;
  const textWidth = width - FRAME_MARGIN * 2;

  const lessonLines = wrapText(lesson, textWidth, {
    family: "ibm-plex-sans",
    weight: 400,
    size: 13,
  });
  const captionLines = wrapText(caption, textWidth, {
    family: "ibm-plex-sans",
    weight: 400,
    size: 11,
  });

  let y = FRAME_MARGIN + 24;
  const header = [];
  header.push(
    t(FRAME_MARGIN, y, title.toUpperCase(), { font: DISPLAY, size: 25, weight: 800, ls: 0.5 }),
  );
  y += 22;
  header.push(wrapped(FRAME_MARGIN, y, lessonLines, { size: 13, fill: INK_SOFT }, 19));
  y += (lessonLines.length - 1) * 19 + 15;
  header.push(`<path d="M${FRAME_MARGIN} ${y}h${textWidth}" stroke="${RULE}" stroke-width="1.5"/>`);
  y += 18;

  const bodyTop = y;
  y += bodyHeight + 20;
  const footer = [];
  footer.push(
    `<path d="M${FRAME_MARGIN} ${y}h${textWidth}" stroke="${RULE}" stroke-opacity=".6"/>`,
  );
  y += 19;
  footer.push(wrapped(FRAME_MARGIN, y, captionLines, { size: 11, fill: INK_MUTE }, 16));
  y += (captionLines.length - 1) * 16;
  if (units) {
    y += 18;
    footer.push(t(FRAME_MARGIN, y, units, { font: MONO, size: 9.5, fill: INK_MUTE }));
  }
  const height = y + FRAME_MARGIN - 6;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-labelledby="${id}-title ${id}-description">
  <title id="${id}-title">${escapeXml(title)}</title>
  <desc id="${id}-description">${escapeXml(description)}</desc>
  ${paper(id, round(width), round(height), 14)}
  ${header.join("\n  ")}
  <g transform="translate(${FRAME_MARGIN} ${round(bodyTop)})">
  ${body}
  </g>
  ${footer.join("\n  ")}
</svg>
`;
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flowMarker(id) {
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${INK_SOFT}"/></marker></defs>`;
}

function chip(cx, cy, label, { fill = ACCENT, r = 9, ink = ACCENT_INK } = {}) {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="${fill}" stroke="${HALO}" stroke-width="1.5"/>
  ${t(cx, cy + 3.5, String(label), { font: MONO, size: 11, weight: 800, fill: ink, anchor: "middle" })}`;
}

function panelChip(x, y, letter) {
  return `<rect x="${x}" y="${y}" width="24" height="24" fill="${ACCENT}"/>
  ${t(x + 12, y + 17, letter, { font: MONO, size: 13, weight: 800, fill: ACCENT_INK, anchor: "middle" })}`;
}

function legendRows(rows, width, top = 0) {
  const spec = { family: "ibm-plex-mono", weight: 400, size: 11 };
  const parts = [];
  let y = top;
  for (const row of rows) {
    const lines = wrapText(row.text, width - 30, spec);
    parts.push(chip(10, y + 4, row.n, row.muted ? { fill: INK_MUTE, ink: SURFACE } : {}));
    parts.push(wrapped(30, y + 8, lines, { font: MONO, size: 11, fill: INK }, 16));
    y += lines.length * 16 + 8;
  }
  return { markup: parts.join("\n  "), height: y - top };
}

function ledgerRows(rows, width, top = 0) {
  const spec = { family: "ibm-plex-mono", weight: 400, size: 11 };
  const termWidth = 150;
  const parts = [];
  let y = top;
  for (const row of rows) {
    const lines = wrapText(row.text, width - termWidth - 12, spec);
    parts.push(t(0, y + 8, row.term, { font: MONO, size: 11, weight: 700, fill: INK_SOFT }));
    parts.push(wrapped(termWidth, y + 8, lines, { font: MONO, size: 11, fill: INK }, 16));
    y += lines.length * 16 + 7;
  }
  return { markup: parts.join("\n  "), height: y - top };
}

function mountChart(rendered, x, y) {
  const { scene, svg } = rendered;
  const chart = { svg, width: scene.width, height: scene.height };
  return placeChart(chart, { x, y, width: scene.width }).markup;
}

function onlyOverlays(DEFAULT_OVERLAYS, ...enabled) {
  const selected = new Set(enabled);
  return Object.fromEntries(
    Object.keys(DEFAULT_OVERLAYS).map((name) => [name, selected.has(name)]),
  );
}

const localTime = (local) => local.slice(11, 16);
const localeRound = (value) => Math.round(value).toLocaleString("en-CA");

async function composeTornRead() {
  const mono12 = { family: "ibm-plex-mono", weight: 400, size: 12 };
  const runLabel = (x, y, prefix, value, valueFill) =>
    t(x, y, prefix, { font: MONO, size: 12, fill: INK_SOFT }) +
    t(x + measureText(`${prefix} `, mono12), y, value, {
      font: MONO,
      size: 12,
      weight: 800,
      fill: valueFill,
    });

  const body = `${flowMarker("torn-read-head")}
  ${panelChip(24, 8, "1")}
  ${t(58, 26, "ONE PUBLISH, TWO CACHE ENTRIES", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 25, "static storage · independent expiry", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="42" x2="956" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>

  <rect x="40" y="60" width="430" height="92" fill="${STRIP_BG}" stroke="${ACCENT}" stroke-width="1.6"/>
  ${t(56, 82, "data/<model>/manifest.json", { font: MONO, size: 12, weight: 700 })}
  ${runLabel(56, 104, "referenceTime", "06Z", ACCENT_STRONG)}
  ${t(56, 130, "cache entry expired first: the new run is visible", { font: MONO, size: 10.5, fill: INK_MUTE })}

  <rect x="510" y="60" width="446" height="92" fill="${STRIP_BG}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(526, 82, "data/<model>/sites/<site>.json", { font: MONO, size: 12, weight: 700 })}
  ${runLabel(526, 104, "run.referenceTime", "00Z", INK)}
  ${t(526, 130, "cache entry still valid: the old run is still served", { font: MONO, size: 10.5, fill: INK_MUTE })}

  ${t(490, 178, "06Z against 00Z: a torn pair. Rendering it as one forecast lies about both runs.", { size: 13, weight: 700, fill: ACCENT_STRONG, anchor: "middle" })}

  ${panelChip(24, 204, "2")}
  ${t(58, 222, "THE SKEW DANCE", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 221, "loadForecast: fetch, compare, retry once", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="238" x2="956" y2="238" stroke="${RULE_STRONG}" stroke-width="1.2"/>

  <rect x="40" y="258" width="200" height="58" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(140, 282, "FETCH THE PAIR", { font: DISPLAY, size: 13.5, weight: 800, ls: 0.4, anchor: "middle" })}
  ${t(140, 300, "manifest + profile, in parallel", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  <path d="M240 287 H302" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#torn-read-head)"/>

  <rect x="304" y="258" width="230" height="58" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(419, 282, "runsConsistent(m, p)?", { font: MONO, size: 12.5, weight: 800, anchor: "middle" })}
  ${t(419, 300, "same model and referenceTime", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  <path d="M534 287 H596" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#torn-read-head)"/>
  ${t(565, 278, "false", { font: MONO, size: 10, fill: INK_MUTE, anchor: "middle" })}

  <rect x="598" y="258" width="160" height="58" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(678, 282, "WAIT ~1.5 s", { font: DISPLAY, size: 13.5, weight: 800, ls: 0.4, anchor: "middle" })}
  ${t(678, 300, "publishes converge quickly", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  <path d="M758 287 H820" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#torn-read-head)"/>

  <rect x="822" y="258" width="134" height="58" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(889, 282, "REFETCH", { font: DISPLAY, size: 13.5, weight: 800, ls: 0.4, anchor: "middle" })}
  ${t(889, 300, "the pair, once", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  ${t(419, 340, "true -> return the pair with stale: false; after the refetch, stale records whether the pair still disagrees", { font: MONO, size: 10, fill: INK_MUTE, anchor: "middle" })}

  ${panelChip(24, 368, "3")}
  ${t(58, 386, "EVERY WAY IT RESOLVES", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 385, 'discriminate a miss with "miss" in result', { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="402" x2="956" y2="402" stroke="${RULE_STRONG}" stroke-width="1.2"/>

  <rect x="40" y="418" width="286" height="66" fill="${SURFACE}" stroke="${ACCENT}" stroke-width="1.6"/>
  ${t(56, 440, "{ manifest, profile, stale: false }", { font: MONO, size: 11.5, weight: 700 })}
  ${t(56, 458, "a consistent pair: render it", { size: 10.5, fill: INK_MUTE })}

  <rect x="346" y="418" width="286" height="66" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(362, 440, "{ manifest, profile, stale: true }", { font: MONO, size: 11.5, weight: 700 })}
  ${t(362, 458, "freshest complete pair, still torn;", { size: 10.5, fill: INK_MUTE })}
  ${t(362, 472, "note it or fall back; never mix the two", { size: 10.5, fill: INK_MUTE })}

  <rect x="652" y="418" width="304" height="66" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(668, 440, '{ miss: "absent" | "invalid", url }', { font: MONO, size: 11.5, weight: 700 })}
  ${t(668, 458, "absent: routine 404 · invalid: contract break;", { size: 10.5, fill: INK_MUTE })}
  ${t(668, 472, "log it loudly; other HTTP errors throw", { size: 10.5, fill: INK_MUTE })}`;

  return frame({
    id: "torn-read",
    title: "Two cache entries, two runs, one page",
    lesson:
      "Independently cached manifest and profile files can describe different runs; loadForecast detects the torn pair and retries it once.",
    description:
      "A sequence diagram of the transport's reference-time skew dance. A publish refreshes the manifest cache entry before the profile cache entry, so a consumer fetching both receives a manifest from the 06Z run and a profile from the 00Z run. loadForecast compares the pair's reference times with runsConsistent, waits 1.5 seconds, refetches, and returns either a consistent pair, the freshest complete pair marked stale, or a discriminated DocumentMiss.",
    caption:
      "The retry delay defaults to 1500 ms and is injectable. The transport keeps no cache and writes no storage: the stale flag is a report, and the policy it triggers belongs to the caller.",
    units: "one publish cycle; no numeric scale",
    bodyWidth: 980,
    bodyHeight: 492,
    body,
  });
}

async function composePointerStates() {
  const state = (x, name, notes, pinned = false) => `
  <rect x="${x}" y="110" width="180" height="76" rx="10" fill="${SURFACE}" stroke="${pinned ? ACCENT : RULE_STRONG}" stroke-width="${pinned ? 2 : 1.4}"/>
  ${t(x + 90, 142, name, { font: DISPLAY, size: 16, weight: 800, ls: 0.32, anchor: "middle" })}
  ${t(x + 90, 162, notes[0], { size: 10.5, fill: INK_MUTE, anchor: "middle" })}
  ${t(x + 90, 175, notes[1], { size: 10.5, fill: INK_MUTE, anchor: "middle" })}`;
  const label = (x, y, content, anchor = "middle") =>
    t(x, y, content, {
      size: 11,
      weight: 600,
      fill: INK_SOFT,
      anchor: anchor === "middle" ? "middle" : undefined,
    });
  const flow = (d, dashed = false) =>
    `<path d="${d}" stroke="${INK_SOFT}" stroke-width="1.5" fill="none"${dashed ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#pointer-states-head)"/>`;

  const body = `${flowMarker("pointer-states-head")}
  ${state(40, "Resting", ["selection shown is the", "stored (or initial) one"])}
  ${state(350, "Previewing", ["consumer overlay tracks", "the pointer, nothing stored"])}
  ${state(660, "Pinned", ["selection stored; rebuild", "with the selection option"], true)}

  ${flow("M220 132 H346")}
  ${label(283, 122, "pointermove · not touch")}
  ${flow("M346 164 H224")}
  ${label(283, 182, "pointerleave")}

  ${flow("M530 148 H656")}
  ${label(593, 138, "click / tap")}

  ${flow("M130 186 C130 262 750 262 750 190")}
  ${label(440, 248, "click / tap: a touch pointer pins without previewing")}

  ${flow("M750 110 C750 44 130 44 130 106")}
  ${label(440, 58, "click the pinned target again · Escape")}

  ${flow("M840 132 C866 132 866 164 840 164")}
  ${t(862, 152, "re-pin", { size: 11, weight: 600, fill: INK_SOFT })}

  <rect x="620" y="272" width="260" height="38" rx="8" fill="${SURFACE_SUNKEN}" stroke="${RULE}"/>
  ${flow("M750 190 V268", true)}
  ${t(750, 288, "model / day swap", { size: 11.5, weight: 700, anchor: "middle" })}
  ${t(750, 302, "reset, or carry by validAt; consumer decides", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}`;

  return frame({
    id: "pointer-states",
    title: "Preview, pin, and the touch policy",
    lesson:
      "The state machine is small and consumer-owned; the package supplies the pure queries its transitions call.",
    description:
      "A three-state diagram: Resting, Previewing, and Pinned. Pointer movement with a non-touch pointer previews; leaving the chart clears the preview; a click or tap pins from any state; clicking the pinned target again, or Escape, unpins; a model or day swap exits the machine entirely, where the consumer chooses reset or carry.",
    caption:
      "Touch pointers skip the Previewing state: a finger cannot hover, so a tap pins directly. The swap edge is the carry-or-reset decision: key the stored selection by validAt and re-resolve it with hourIndexForValidAt, or reset, as the measured first consumer does.",
    bodyWidth: 900,
    bodyHeight: 318,
    body,
  });
}

const PUBLICATION_STAGES = [
  {
    number: "1",
    title: "Upstream model products",
    detail: "ECCC or NOAA publishes a forecast cycle.",
  },
  {
    number: "2",
    title: "Completeness probe",
    detail: "Request the final required hour before fetching the run.",
  },
  {
    number: "3",
    title: "Per-model builder",
    detail: "Fetch required records; verify; derive; serialize.",
  },
  {
    number: "4",
    title: "Publish to storage",
    detail:
      "Upload every completed model directory and append one history record per site and run.",
  },
  {
    number: "5",
    title: "Consumer read",
    detail: "Fetch manifest and profile; compare referenceTime; expose a torn pair as stale.",
  },
];

async function composePublicationFlow() {
  const width = 980;
  const cell = width / 5;
  const circleY = 24;
  const titleSpec = { family: "ibm-plex-sans", weight: 700, size: 14 };
  const detailSpec = { family: "ibm-plex-sans", weight: 400, size: 12.5 };

  const stages = PUBLICATION_STAGES.map((stage, index) => {
    const cx = cell * index + cell / 2;
    const accent = index === 3;
    const titleLines = wrapText(stage.title, cell - 22, titleSpec);
    const detailLines = wrapText(stage.detail, cell - 22, detailSpec);
    const parts = [];
    parts.push(
      `<circle cx="${round(cx)}" cy="${circleY}" r="19" fill="${accent ? SURFACE_ACCENT : SURFACE}" stroke="${accent ? ACCENT : RULE_STRONG}" stroke-width="2"/>`,
    );
    parts.push(
      t(cx, circleY + 5, stage.number, {
        font: MONO,
        size: 14,
        weight: 700,
        fill: accent ? ACCENT_STRONG : INK,
        anchor: "middle",
      }),
    );
    let y = circleY + 42;
    for (const line of titleLines) {
      parts.push(t(cx, y, line, { size: 14, weight: 700, anchor: "middle" }));
      y += 18;
    }
    y += 2;
    for (const line of detailLines) {
      parts.push(t(cx, y, line, { size: 12.5, fill: INK_SOFT, anchor: "middle" }));
      y += 17;
    }
    return { markup: parts.join("\n  "), bottom: y };
  });

  const stagesBottom = Math.max(...stages.map((stage) => stage.bottom)) + 8;
  const boundaryY = stagesBottom + 14;

  const body = `<path d="M${round(cell / 2)} ${circleY} H${round(width - cell / 2)}" stroke="${RULE_STRONG}" stroke-width="2"/>
  ${stages.map((stage) => stage.markup).join("\n  ")}
  <path d="M0 ${round(stagesBottom)} h${width}" stroke="${RULE}"/>
  ${t(0, boundaryY + 12, "STATIC DATASET PUBLICATION", { font: MONO, size: 12, weight: 700, ls: 0.5, fill: ACCENT_STRONG })}
  ${t(width, boundaryY + 12, "manifest.json · site profiles · append-only history", { font: MONO, size: 12, fill: INK_MUTE, anchor: "end" })}
  <path d="M0 ${round(boundaryY + 24)} h${width}" stroke="${INK}" stroke-width="2"/>`;

  return frame({
    id: "publication-flow",
    title: "Publication flow from model cycle to browser",
    lesson:
      "A run is published only after completeness and derivation checks, then read as static files.",
    description:
      "A five-stage sequence from upstream forecast publication through completeness probing, model-specific building, one static publication, and a consumer consistency check.",
    caption:
      "Builders complete independently. Each polling cycle publishes every finished model update once; consumers compare independently cached static files and choose their own stale-pair policy.",
    units: "ordered stages; no numeric scale",
    bodyWidth: width,
    bodyHeight: boundaryY + 26,
    body,
  });
}

async function composeTwoTransports(ctx) {
  const idxPath = join(ctx.root, "grib", "test", "fixtures-idx", "hrrr.t12z.wrfprsf24.excerpt.idx");
  const idxLines = readFileSync(idxPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => line.split(":"));

  const wanted = [
    { varName: "HGT", level: "850 mb", label: "HGT:850 mb" },
    { varName: "UGRD", level: "850 mb", label: "UGRD:850 mb" },
    { varName: "TMP", level: "2 m above ground", label: "TMP:2 m" },
    { varName: "DPT", level: "2 m above ground", label: "DPT:2 m" },
  ];
  const records = wanted.map(({ varName, level, label }) => {
    const line = idxLines.find((fields) => fields[3] === varName && fields[4] === level);
    if (!line) throw new Error(`record ${varName}:${level} missing from ${idxPath}`);
    return { label, record: Number(line[0]), offset: Number(line[1]) };
  });
  const runStamp = idxLines[0][2].replace("d=", "");
  const runLabel = `${runStamp.slice(0, 4)}-${runStamp.slice(4, 6)}-${runStamp.slice(6, 8)} ${runStamp.slice(8, 10)}Z`;
  const maxOffset = Math.max(...idxLines.map((fields) => Number(fields[1])));
  const fileFloorMb = Math.round(maxOffset / 1e6);
  const bytes = (offset) => offset.toLocaleString("en-CA");

  const BAR_LEFT = 340;
  const BAR_RIGHT = 936;
  const hits = records.map((record, index) => ({
    ...record,
    n: index + 1,
    x: BAR_LEFT + (record.offset / maxOffset) * (BAR_RIGHT - BAR_LEFT),
  }));
  for (let i = 1; i < hits.length; i += 1) {
    if (hits[i].x - hits[i - 1].x < 26) hits[i] = { ...hits[i], x: hits[i - 1].x + 26 };
  }

  const numChip = (cx, cy, n) =>
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="7" fill="${SURFACE}" stroke="${ACCENT}" stroke-width="1.4"/>
  ${t(cx, cy + 3.5, String(n), { font: MONO, size: 10, weight: 700, fill: ACCENT_STRONG, anchor: "middle" })}`;

  const gribBox = (x, dropped = false) =>
    dropped
      ? `<rect x="${x}" y="324" width="84" height="80" fill="${SURFACE}" stroke="${RULE}" stroke-width="1.2" stroke-dasharray="4 4" opacity=".55"/>`
      : `<rect x="${x}" y="324" width="84" height="80" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.4"/>`;

  const site = (cx, cy) =>
    `<circle cx="${cx}" cy="${cy}" r="3.4" fill="${ACCENT}"/><circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="${ACCENT}" stroke-width="1" opacity=".5"/>`;

  const body = `${flowMarker("two-transports-head")}
  ${panelChip(24, 8, "A")}
  ${t(58, 26, "INDEXED BYTE RANGES", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 25, "NOAA · HRRR, GFS", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="42" x2="956" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>

  <rect x="40" y="58" width="280" height="122" fill="${STRIP_BG}" stroke="${RULE}"/>
  ${t(54, 78, ".idx SIDECAR · PLAIN TEXT, FREE", { font: MONO, size: 11, weight: 700, ls: 0.55 })}
  ${hits
    .map(
      (hit, index) => `${numChip(62, 96 + index * 20, hit.n)}
  ${t(76, 100 + index * 20, hit.label, { font: MONO, size: 10, fill: INK_SOFT })}
  ${t(176, 100 + index * 20, `byte ${bytes(hit.offset)}`, { font: MONO, size: 10, fill: INK_MUTE })}`,
    )
    .join("\n  ")}

  ${t(340, 82, `hrrr.t12z.wrfprsf24.grib2 · run ${runLabel} · one record per field and level`, { font: MONO, size: 11, weight: 600, fill: INK_SOFT })}
  <rect x="${BAR_LEFT}" y="100" width="${BAR_RIGHT - BAR_LEFT}" height="36" fill="${SURFACE_SUNKEN}" stroke="${RULE}" stroke-width=".7"/>
  ${hits
    .map(
      (hit) => `${numChip(hit.x, 90, hit.n)}
  <rect x="${round(hit.x - 4.5)}" y="100" width="9" height="36" fill="${ACCENT}" stroke="${ACCENT_STRONG}" stroke-width=".8"/>`,
    )
    .join("\n  ")}
  ${t(340, 156, "unshaded bytes never leave NOAA's bucket", { font: MONO, size: 10.5, fill: INK_MUTE })}
  ${t(40, 204, "the index alone places records", { font: MONO, size: 10.5, fill: INK_MUTE })}
  ${t(40, 218, `beyond byte ${bytes(maxOffset)}, over ${fileFloorMb} MB`, { font: MONO, size: 10.5, fill: INK_MUTE })}

  ${hits
    .map(
      (hit) =>
        `<path d="M${round(hit.x)} 136 C${round(hit.x)} 154 ${round((hit.x + 640) / 2)} 158 ${round(640 + (hit.x - 640) / 6)} 168" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#two-transports-head)"/>`,
    )
    .join("\n  ")}

  <rect x="470" y="172" width="340" height="52" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(640, 193, "ONE RANGE REQUEST PER NEEDED RECORD", { font: DISPLAY, size: 15, weight: 800, ls: 0.45, anchor: "middle" })}
  ${t(640, 211, "megabytes cross the network; the file stays on the shelf", { size: 10.5, fill: INK_SOFT, anchor: "middle" })}

  ${panelChip(24, 252, "B")}
  ${t(58, 270, "WHOLE-DOMAIN STREAM", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 269, "ECCC · HRDPS, RDPS, GDPS, REPS, GEPS; Datamart has no index", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="286" x2="956" y2="286" stroke="${RULE_STRONG}" stroke-width="1.2"/>

  ${t(150, 312, "1 · FETCH", { font: DISPLAY, size: 14, weight: 800, ls: 0.56, anchor: "middle" })}
  ${gribBox(108)}
  <line x1="116" y1="340" x2="184" y2="340" stroke="${RULE}" stroke-width=".8" opacity=".8"/>
  <line x1="116" y1="354" x2="184" y2="354" stroke="${RULE}" stroke-width=".8" opacity=".8"/>
  <line x1="116" y1="368" x2="184" y2="368" stroke="${RULE}" stroke-width=".8" opacity=".8"/>
  <line x1="116" y1="382" x2="184" y2="382" stroke="${RULE}" stroke-width=".8" opacity=".8"/>
  ${t(150, 424, "the whole domain,", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}
  ${t(150, 438, "one message per file", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  <path d="M200 364 H396" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#two-transports-head)"/>

  ${t(450, 312, "2 · SAMPLE IN MEMORY", { font: DISPLAY, size: 14, weight: 800, ls: 0.56, anchor: "middle" })}
  ${gribBox(408)}
  ${site(430, 346)}
  ${site(462, 358)}
  ${site(440, 380)}
  ${site(474, 388)}
  ${t(450, 424, "read once; keep only the", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}
  ${t(450, 438, "catalogued launch cells", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  <path d="M500 364 H696" stroke="${INK_SOFT}" stroke-width="1.5" fill="none" marker-end="url(#two-transports-head)"/>

  ${t(750, 312, "3 · DROP", { font: DISPLAY, size: 14, weight: 800, ls: 0.56, anchor: "middle" })}
  ${gribBox(708, true)}
  ${t(750, 424, "released before the", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}
  ${t(750, 438, "next fetch begins", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}

  ${t(490, 464, "repeat, file after file, through the run; memory never holds more than a handful of files", { font: MONO, size: 11.5, weight: 600, fill: INK_SOFT, anchor: "middle" })}

  <line x1="490" y1="478" x2="490" y2="522" stroke="${RULE}" stroke-width="1"/>
  ${t(60, 506, "4–8 GiB", { font: DISPLAY, size: 28, weight: 800, ls: 0.28 })}
  ${t(200, 496, "moved per deterministic run;", { size: 11, fill: INK_MUTE })}
  ${t(200, 511, "~9 GiB REPS · ~14 GiB GEPS", { size: 11, fill: INK_MUTE })}
  ${t(530, 506, "kilobytes kept", { font: DISPLAY, size: 28, weight: 800, ls: 0.28 })}
  ${t(756, 496, "per site and run: the profile JSON", { size: 11, fill: INK_MUTE })}
  ${t(756, 511, "is what actually gets published", { size: 11, fill: INK_MUTE })}`;

  return frame({
    id: "two-transports",
    title: "Two transports, one job",
    lesson:
      "NOAA exposes indexed byte ranges while ECCC publishes whole files, so each builder follows its provider's transport contract.",
    description: `A comparison of NOAA indexed byte ranges and ECCC whole-domain streaming. Four HRRR records are located at byte offsets read from the repository fixture for ${runLabel}; ECCC builders stream one file at a time, sample configured sites, and discard the file.`,
    caption:
      "Record numbers and offsets come from the committed HRRR index fixture (grib/test/fixtures-idx/hrrr.t12z.wrfprsf24.excerpt.idx); run-volume context comes from the project measurements recorded with the pipeline research.",
    units: "byte offsets and transferred GiB where labelled",
    bodyWidth: 980,
    bodyHeight: 530,
    body,
  });
}

const DEG = Math.PI / 180;

/* Orthographic projection for the schematic globe: view-centred, with a
   visibility flag so graticule paths break cleanly at the limb. */
function orthographic(centerLat, centerLon, radius, cx, cy) {
  const sinC = Math.sin(centerLat * DEG);
  const cosC = Math.cos(centerLat * DEG);
  return (lat, lon) => {
    const phi = lat * DEG;
    const dLon = (lon - centerLon) * DEG;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    return {
      x: cx + radius * cosPhi * Math.sin(dLon),
      y: cy - radius * (cosC * sinPhi - sinC * cosPhi * Math.cos(dLon)),
      visible: sinC * sinPhi + cosC * cosPhi * Math.cos(dLon) > 0.001,
    };
  };
}

function arcPath(points, close = false) {
  let d = "";
  let pen = false;
  for (const point of points) {
    if (!point.visible) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${round(point.x)} ${round(point.y)}`;
    pen = true;
  }
  return d === "" ? "" : d + (close ? "Z" : "");
}

async function composeRotatedGrid(ctx) {
  const { fromRotated, nearestGridpoint, parseFields, parseGrid, splitMessages, toRotated } =
    await ctx.importPackage("grib");
  const fixturePath = join(ctx.root, "grib", "test", "fixtures", "hrdps-continental-tmp-2m.grib2");
  const field = parseFields(splitMessages(new Uint8Array(readFileSync(fixturePath)))[0])[0];
  const grid = parseGrid(field.section3);
  if (grid.kind !== "rotated") {
    throw new Error(
      "[rotated-grid] the HRDPS continental fixture no longer parses as template 3.1",
    );
  }

  const launch = { latitude: 49.3634, longitude: -117.2361 };
  const nearest = nearestGridpoint(grid, launch.latitude, launch.longitude);
  const rot = toRotated(
    launch.latitude,
    launch.longitude,
    grid.southPoleLatitude,
    grid.southPoleLongitude,
  );
  const signed = (lon) => ((lon + 540) % 360) - 180;
  const poleLon = signed(grid.southPoleLongitude);
  const rotLon0 = signed(grid.longitudeOfFirstGridPoint);
  const rotLat0 = grid.latitudeOfFirstGridPoint;
  const di = grid.iDirectionIncrement;
  const dj = grid.jDirectionIncrement;
  const iFrac = (rot.longitude - rotLon0) / di;
  const jFrac = (rot.latitude - rotLat0) / dj;
  const iIndex = nearest.index % grid.ni;
  const jIndex = Math.floor(nearest.index / grid.ni);
  if (Math.round(iFrac) !== iIndex || Math.round(jFrac) !== jIndex) {
    throw new Error(
      "[rotated-grid] the analytic inverse and nearestGridpoint disagree on the cell",
    );
  }
  if (jIndex * grid.ni + iIndex !== nearest.index) {
    throw new Error("[rotated-grid] the storage-order index no longer decomposes as j * ni + i");
  }
  const kmPerDeg = (grid.earthRadiusM * Math.PI) / 180 / 1000;
  const cosLat = Math.cos(launch.latitude * DEG);
  const dxKm = signed(nearest.longitude - launch.longitude) * kmPerDeg * cosLat;
  const dyKm = (nearest.latitude - launch.latitude) * kmPerDeg;
  if (Math.abs(Math.hypot(dxKm, dyKm) - nearest.distanceKm) > 0.005) {
    throw new Error("[rotated-grid] the drawn residual does not reproduce the reported distanceKm");
  }
  const deg = (value, digits = 4) => `${value.toFixed(digits)}°`;
  /* Labels sit over graticule strokes throughout; a paper-coloured halo
     keeps them legible without erasing the geometry beneath. */
  const haloT = (x, y, content, o = {}) =>
    t(x, y, content, o).replace(
      "<text ",
      `<text stroke="${HALO}" stroke-width="3" paint-order="stroke" `,
    );

  /* ── Panel A: the two graticules on a schematic globe ── */
  const gx = 210;
  const gy = 232;
  const R = 168;
  const project = orthographic(10, -114, R, gx, gy);
  const truePaths = [];
  for (let lat = -60; lat <= 80; lat += 20) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(project(lat, lon));
    truePaths.push(arcPath(pts));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -88; lat <= 88; lat += 3) pts.push(project(lat, lon));
    truePaths.push(arcPath(pts));
  }
  const rotatedSample = (rlat, rlon) => {
    const geo = fromRotated(rlat, rlon, grid.southPoleLatitude, grid.southPoleLongitude);
    return project(geo.latitude, geo.longitude);
  };
  const rotatedPaths = [];
  for (let rlat = -60; rlat <= 80; rlat += 20) {
    if (rlat === 0) continue;
    const pts = [];
    for (let rlon = -180; rlon <= 180; rlon += 3) pts.push(rotatedSample(rlat, rlon));
    rotatedPaths.push(arcPath(pts));
  }
  for (let rlon = -180; rlon < 180; rlon += 30) {
    const pts = [];
    for (let rlat = -88; rlat <= 88; rlat += 3) pts.push(rotatedSample(rlat, rlon));
    rotatedPaths.push(arcPath(pts));
  }
  const equatorPts = [];
  for (let rlon = -180; rlon <= 180; rlon += 2) equatorPts.push(rotatedSample(0, rlon));
  const rotLon1 = rotLon0 + (grid.ni - 1) * di;
  const rotLat1 = rotLat0 + (grid.nj - 1) * dj;
  const domainPts = [];
  for (let rlon = rotLon0; rlon <= rotLon1; rlon += 0.75)
    domainPts.push(rotatedSample(rotLat0, rlon));
  for (let rlat = rotLat0; rlat <= rotLat1; rlat += 0.75)
    domainPts.push(rotatedSample(rlat, rotLon1));
  for (let rlon = rotLon1; rlon >= rotLon0; rlon -= 0.75)
    domainPts.push(rotatedSample(rotLat1, rlon));
  for (let rlat = rotLat1; rlat >= rotLat0; rlat -= 0.75)
    domainPts.push(rotatedSample(rlat, rotLon0));
  const pole = project(grid.southPoleLatitude, poleLon);
  const northPole = project(90, 0);
  const launchOnGlobe = project(launch.latitude, launch.longitude);
  const domainLabelAt = rotatedSample(rotLat0, (rotLon0 + rotLon1) / 2);

  const panelA = `${panelChip(24, 8, "A")}
  ${t(58, 26, "TWO GRATICULES, ONE DOMAIN", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(430, 25, "schematic globe", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="42" x2="430" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  <circle cx="${gx}" cy="${gy}" r="${R}" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.5"/>
  <path d="${truePaths.join(" ")}" fill="none" stroke="${RULE_STRONG}" stroke-width=".7" stroke-opacity=".5"/>
  <path d="${rotatedPaths.join(" ")}" fill="none" stroke="${INK_SOFT}" stroke-width=".9" stroke-dasharray="4 3"/>
  <path d="${arcPath(equatorPts)}" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.7" stroke-dasharray="7 4"/>
  <path d="${arcPath(domainPts, true)}" fill="${ACCENT}" fill-opacity=".2" stroke="${ACCENT_STRONG}" stroke-width="1.4"/>
  ${northPole.visible ? haloT(northPole.x, northPole.y - 6, "N", { font: MONO, size: 10, weight: 700, fill: INK_SOFT, anchor: "middle" }) : ""}
  ${haloT(domainLabelAt.x, domainLabelAt.y + 16, "HRDPS domain", { font: MONO, size: 10, weight: 700, fill: ACCENT_STRONG, anchor: "middle" })}
  <circle cx="${round(launchOnGlobe.x)}" cy="${round(launchOnGlobe.y)}" r="3.4" fill="${ACCENT}" stroke="${HALO}" stroke-width="1.2"/>
  ${haloT(launchOnGlobe.x - 9, launchOnGlobe.y + 3.5, "launch", { font: MONO, size: 10, weight: 700, fill: INK, anchor: "end" })}
  <path d="M${round(pole.x)} ${round(pole.y - 6)} L${round(pole.x + 6)} ${round(pole.y)} L${round(pole.x)} ${round(pole.y + 6)} L${round(pole.x - 6)} ${round(pole.y)} Z" fill="${ACCENT_STRONG}" stroke="${HALO}" stroke-width="1.2"/>
  ${haloT(pole.x + 11, pole.y - 1, "rotated south pole", { font: MONO, size: 10, weight: 700, fill: INK })}
  ${haloT(pole.x + 11, pole.y + 12, `${deg(grid.southPoleLatitude)}, ${deg(poleLon)}`, { font: MONO, size: 9.5, fill: INK_MUTE })}
  <path d="M40 428 h26" stroke="${RULE_STRONG}" stroke-width="1.4"/>
  ${t(76, 432, "true graticule · solid", { font: MONO, size: 10, fill: INK_SOFT })}
  <path d="M40 446 h26" stroke="${INK_SOFT}" stroke-width="1.2" stroke-dasharray="4 3"/>
  ${t(76, 450, "rotated graticule · dashed · heavy dash: rotated equator", { font: MONO, size: 10, fill: INK_SOFT })}`;

  /* ── Panel B: the inverse at the launch, gridlines mapped through fromRotated ── */
  const bx = 470;
  const bw = 510;
  const bTop = 58;
  const bh = 282;
  const bcx = bx + bw / 2;
  const bcy = bTop + bh / 2;
  const S = 2700;
  const loc = (lat, lon) => ({
    x: bcx + signed(lon - launch.longitude) * cosLat * S,
    y: bcy - (lat - launch.latitude) * S,
  });
  const patch = [];
  patch.push(
    `<clipPath id="rotated-grid-patch"><rect x="${bx}" y="${bTop}" width="${bw}" height="${bh}"/></clipPath>`,
  );
  patch.push(
    `<rect x="${bx}" y="${bTop}" width="${bw}" height="${bh}" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  );
  const clipped = [];
  for (const lat of [49.3, 49.35, 49.4]) {
    const y = round(loc(lat, launch.longitude).y);
    clipped.push(
      `<path d="M${bx} ${y} h${bw}" stroke="${RULE_STRONG}" stroke-width=".7" stroke-opacity=".55"/>`,
    );
    clipped.push(
      haloT(bx + 6, y - 4, `${lat.toFixed(2)}°N`, { font: MONO, size: 9, fill: INK_MUTE }),
    );
  }
  for (const lon of [-117.3, -117.25, -117.2, -117.15]) {
    const x = round(loc(launch.latitude, lon).x);
    clipped.push(
      `<path d="M${x} ${bTop} v${bh}" stroke="${RULE_STRONG}" stroke-width=".7" stroke-opacity=".55"/>`,
    );
    clipped.push(
      haloT(x + 3, bTop + bh - 6, `${Math.abs(lon).toFixed(2)}°W`, {
        font: MONO,
        size: 9,
        fill: INK_MUTE,
      }),
    );
  }
  const rotatedLocal = (rlat, rlon) => {
    const geo = fromRotated(rlat, rlon, grid.southPoleLatitude, grid.southPoleLongitude);
    return loc(geo.latitude, geo.longitude);
  };
  const polyline = (pts) =>
    pts.map((p, index) => `${index === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join("");
  const meridianTopX = new Map();
  for (let i = iIndex - 6; i <= iIndex + 6; i += 1) {
    const rlon = rotLon0 + i * di;
    const pts = [];
    for (let rlat = rot.latitude - 0.11; rlat <= rot.latitude + 0.11; rlat += 0.02) {
      pts.push(rotatedLocal(rlat, rlon));
    }
    clipped.push(
      `<path d="${polyline(pts)}" fill="none" stroke="${INK_SOFT}" stroke-width="1" stroke-dasharray="5 3"/>`,
    );
    const top = pts.reduce((best, p) =>
      Math.abs(p.y - (bTop + 16)) < Math.abs(best.y - (bTop + 16)) ? p : best,
    );
    meridianTopX.set(i, top.x);
  }
  const parallelRightY = new Map();
  for (let j = jIndex - 5; j <= jIndex + 5; j += 1) {
    const rlat = rotLat0 + j * dj;
    const pts = [];
    for (let rlon = rot.longitude - 0.16; rlon <= rot.longitude + 0.16; rlon += 0.02) {
      pts.push(rotatedLocal(rlat, rlon));
    }
    clipped.push(
      `<path d="${polyline(pts)}" fill="none" stroke="${INK_SOFT}" stroke-width="1" stroke-dasharray="5 3"/>`,
    );
    const rightTarget = bx + bw - 24;
    const right = pts.reduce((best, p) =>
      Math.abs(p.x - rightTarget) < Math.abs(best.x - rightTarget) ? p : best,
    );
    parallelRightY.set(j, right.y);
  }
  for (const i of [iIndex - 2, iIndex, iIndex + 2]) {
    const x = meridianTopX.get(i);
    clipped.push(
      haloT(x + 4, bTop + 16, i === iIndex ? `i ${i}` : String(i), {
        font: MONO,
        size: 9.5,
        weight: i === iIndex ? 700 : 400,
        fill: i === iIndex ? ACCENT_STRONG : INK_MUTE,
      }),
    );
  }
  for (const j of [jIndex - 2, jIndex, jIndex + 2]) {
    const y = parallelRightY.get(j);
    clipped.push(
      haloT(bx + bw - 8, y - 4, j === jIndex ? `j ${j}` : String(j), {
        font: MONO,
        size: 9.5,
        weight: j === jIndex ? 700 : 400,
        fill: j === jIndex ? ACCENT_STRONG : INK_MUTE,
        anchor: "end",
      }),
    );
  }
  for (let i = iIndex - 6; i <= iIndex + 6; i += 1) {
    for (let j = jIndex - 5; j <= jIndex + 5; j += 1) {
      const p = rotatedLocal(rotLat0 + j * dj, rotLon0 + i * di);
      clipped.push(`<circle cx="${round(p.x)}" cy="${round(p.y)}" r="1.8" fill="${INK_MUTE}"/>`);
    }
  }
  const launchAt = loc(launch.latitude, launch.longitude);
  const gridpointAt = loc(nearest.latitude, nearest.longitude);
  clipped.push(
    `<circle cx="${round(gridpointAt.x)}" cy="${round(gridpointAt.y)}" r="6.5" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.8"/>`,
  );
  clipped.push(
    `<circle cx="${round(launchAt.x)}" cy="${round(launchAt.y)}" r="3.2" fill="${ACCENT}" stroke="${HALO}" stroke-width="1.2"/>`,
  );
  clipped.push(
    `<circle cx="${round(launchAt.x)}" cy="${round(launchAt.y)}" r="15" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.2"/>`,
  );
  clipped.push(
    haloT(launchAt.x - 24, launchAt.y - 26, `launch -> cell (i ${iIndex}, j ${jIndex})`, {
      font: MONO,
      size: 10,
      weight: 700,
      fill: INK,
      anchor: "end",
    }),
  );
  clipped.push(
    haloT(
      launchAt.x - 24,
      launchAt.y - 12,
      `index ${jIndex} × ${grid.ni} + ${iIndex} = ${nearest.index}`,
      {
        font: MONO,
        size: 10,
        fill: INK_SOFT,
        anchor: "end",
      },
    ),
  );

  /* Magnifier inset: the residual is ~16× smaller than a cell, so it gets
     its own scale, with the zoom factor computed from the two scales. */
  const inW = 212;
  const inH = 136;
  const inX = bx + 20;
  const inY = bTop + bh + 14;
  const insetScale = 470; // px per km
  const zoom = Math.round(insetScale / (S / kmPerDeg));
  const inLaunch = { x: inX + 58, y: inY + 96 };
  const inGrid = { x: inLaunch.x + dxKm * insetScale, y: inLaunch.y - dyKm * insetScale };
  const inset = `<path d="M${round(launchAt.x - 5)} ${round(launchAt.y + 14)} L${round(inX + inW)} ${round(inY)}" stroke="${ACCENT_STRONG}" stroke-width="1" stroke-dasharray="3 3"/>
  <rect x="${inX}" y="${inY}" width="${inW}" height="${inH}" fill="${STRIP_BG}" stroke="${ACCENT_STRONG}" stroke-width="1.3"/>
  ${t(inX + 8, inY + 15, `×${zoom} magnified`, { font: MONO, size: 9.5, weight: 700, fill: ACCENT_STRONG })}
  <path d="M${round(inLaunch.x)} ${round(inLaunch.y)} L${round(inGrid.x)} ${round(inGrid.y)}" stroke="${ACCENT_STRONG}" stroke-width="1.6"/>
  <circle cx="${round(inGrid.x)}" cy="${round(inGrid.y)}" r="6.5" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.8"/>
  <circle cx="${round(inLaunch.x)}" cy="${round(inLaunch.y)}" r="3.2" fill="${ACCENT}" stroke="${HALO}" stroke-width="1.2"/>
  ${t(inLaunch.x - 6, inLaunch.y + 14, "launch", { font: MONO, size: 9.5, fill: INK_SOFT })}
  ${t(inGrid.x + 10, inGrid.y + 3, "gridpoint", { font: MONO, size: 9.5, fill: INK_SOFT })}
  ${t((inLaunch.x + inGrid.x) / 2 - 8, (inLaunch.y + inGrid.y) / 2 + 12, `distanceKm ${nearest.distanceKm.toFixed(3)} km`, { font: MONO, size: 10, weight: 700, fill: ACCENT_STRONG })}
  <path d="M${inX + inW - 8 - insetScale * 0.1} ${inY + inH - 12} h${round(insetScale * 0.1)}" stroke="${INK}" stroke-width="2"/>
  ${t(inX + inW - 8 - insetScale * 0.05, inY + inH - 18, "100 m", { font: MONO, size: 9, fill: INK_MUTE, anchor: "middle" })}`;

  const panelB = `${panelChip(470, 8, "B")}
  ${t(504, 26, "THE INVERSE, AT THE LAUNCH", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(980, 25, `${di.toFixed(4)}° cells · rotated frame`, { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="470" y1="42" x2="980" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${patch.join("\n  ")}
  <g clip-path="url(#rotated-grid-patch)">
  ${clipped.join("\n  ")}
  </g>
  ${inset}`;

  const rows = [
    {
      term: "grid",
      text:
        `template 3.${grid.gridDefinitionTemplateNumber} rotated latitude-longitude · ` +
        `${grid.ni} × ${grid.nj} points at ${di.toFixed(4)}° rotated spacing ` +
        `(hrdps-continental-tmp-2m.grib2)`,
    },
    {
      term: "rotated pole",
      text:
        `south pole of the rotated frame at ${deg(grid.southPoleLatitude)}, ${deg(poleLon)}: ` +
        `the graticule tilted until the domain lies along the rotated equator`,
    },
    {
      term: "analytic inverse",
      text:
        `toRotated(${deg(launch.latitude)}, ${deg(launch.longitude)}) -> ` +
        `(${deg(rot.latitude)}, ${deg(rot.longitude)}) rotated · ` +
        `i = ${iFrac.toFixed(2)} -> ${iIndex} · j = ${jFrac.toFixed(2)} -> ${jIndex} · ` +
        `index ${nearest.index}`,
    },
    {
      term: "residual",
      text:
        `nearestGridpoint -> ${deg(nearest.latitude)}, ${deg(nearest.longitude)} at ` +
        `distanceKm ${nearest.distanceKm.toFixed(3)} km (reported, never thrown): ` +
        `the distance is the caller's out-of-domain guard`,
    },
  ];
  const ledger = ledgerRows(rows, 980, 512);

  return frame({
    id: "rotated-grid",
    title: "Why template 3.1 needs an analytic inverse",
    lesson:
      "A rotated grid's rows follow a tilted frame, not the true graticule: toRotated maps a geographic point straight to fractional grid coordinates, and the reported distance is the residual.",
    description: `Two panels. Left, a schematic globe: the true graticule in solid strokes, the rotated graticule in dashed strokes, the rotated south pole marked at ${deg(grid.southPoleLatitude)}, ${deg(poleLon)}, and the HRDPS continental domain lying along the rotated equator. Right, the neighbourhood of the launch at ${deg(launch.latitude)}, ${deg(launch.longitude)}: dashed rotated gridlines at ${di.toFixed(4)}° spacing tilted against the solid true graticule, the launch mapped by toRotated to rotated (${deg(rot.latitude)}, ${deg(rot.longitude)}), fractional cell (${iFrac.toFixed(2)}, ${jFrac.toFixed(2)}), nearest gridpoint (i ${iIndex}, j ${jIndex}) = storage index ${nearest.index}, with the ${nearest.distanceKm.toFixed(3)} km residual drawn in a magnified inset.`,
    caption:
      "Every number is computed at figure-generation time from the committed HRDPS continental fixture through the built package: parseGrid for the pole and spacing, toRotated for the inverse, nearestGridpoint for the index and distance. The globe is schematic; the pole, domain, gridlines, index, and residual are the fixture's real values.",
    units: "coordinates degrees · grid spacing degrees (rotated frame) · residual km and m",
    bodyWidth: 980,
    bodyHeight: 512 + ledger.height,
    body: `${panelA}
  ${panelB}
  ${ledger.markup}`,
  });
}

async function composeContractAnatomy(ctx) {
  const { p50 } = await ctx.importPackage("briefing/derive");
  const profile = await ctx.loadProfile("convective-cycle");

  let hourIndex = 0;
  let bestWstar = -Infinity;
  profile.hours.forEach((hour, index) => {
    const wstar = p50(hour.derived.thermalVelocityMps);
    if (wstar !== null && wstar > bestWstar) {
      bestWstar = wstar;
      hourIndex = index;
    }
  });
  const hour = profile.hours[hourIndex];
  const show = (value) => JSON.stringify(value, null, 2);

  const segments = [
    {
      path: "schemaVersion · model",
      role: "Check schemaVersion before anything else; model is an open catalogue slug, not a package enum.",
      json: show({ schemaVersion: profile.schemaVersion, model: profile.model }),
    },
    {
      path: "run",
      role: "Publication identity: (referenceTime, generatedAt). Ensemble documents add total membership at run.members.",
      json: show(profile.run),
    },
    {
      path: "site",
      role: "Sample provenance: identity, coordinates, the model's own terrain (modelElevationM), and the optional timezone echo. No launch elevation: the launch is supplied at render time, not stored in the document.",
      json: show(profile.site),
    },
    ...(profile.semantics
      ? [
          {
            path: "semantics",
            role: "Optional gust and precipitation meaning, stored with the document; absence creates no default.",
            json: show(profile.semantics),
          },
        ]
      : []),
    {
      path: `hours[${hourIndex}].surface`,
      role: `One of ${profile.hours.length} chronological UTC hours, the peak-W* hour here. Optional capability fields are absent, never zero.`,
      json: show({ validAt: hour.validAt, surface: hour.surface }),
    },
    {
      path: `hours[${hourIndex}].levels[0]`,
      role: `First of ${hour.levels.length} ascending pressure levels: height, temperature, moisture, and wind per isobaric coordinate.`,
      json: show(hour.levels[0]),
    },
    {
      path: `hours[${hourIndex}].derived`,
      role: "The pipeline-owned block: boundary-layer top, thermal velocity, cloud base, and the stored 1.0 m/s usable-lift top.",
      json: show(hour.derived),
    },
  ];

  const metaWidth = 300;
  const codeX = metaWidth + 18;
  const codeWidth = 620;
  const roleSpec = { family: "ibm-plex-sans", weight: 400, size: 11 };

  const parts = [];
  let y = 0;
  segments.forEach((segment, index) => {
    if (index > 0) {
      parts.push(
        `<path d="M0 ${round(y)} h${codeX + codeWidth}" stroke="${RULE}" stroke-opacity=".55"/>`,
      );
      y += 14;
    }
    const roleLines = wrapText(segment.role, metaWidth - 8, roleSpec);
    parts.push(
      t(0, y + 14, segment.path, { font: MONO, size: 11.5, weight: 700, fill: ACCENT_STRONG }),
    );
    parts.push(wrapped(0, y + 32, roleLines, { size: 11, fill: INK_SOFT }, 15));
    const metaHeight = 32 + roleLines.length * 15;

    const jsonLines = segment.json.split("\n");
    const monoProbe = { family: "ibm-plex-mono", weight: 400, size: 10 };
    const maxLine = Math.max(...jsonLines.map((line) => measureText(line, monoProbe)));
    const size = Math.min(10, round((10 * (codeWidth - 28)) / Math.max(maxLine, 1)));
    const lineHeight = round(size * 1.45);
    const codeHeight = 24 + jsonLines.length * lineHeight;
    parts.push(
      `<rect x="${codeX}" y="${round(y)}" width="${codeWidth}" height="${round(codeHeight)}" rx="6" fill="${CODE_BG}"/>`,
    );
    jsonLines.forEach((line, lineIndex) => {
      let cx = codeX + 14;
      const spec = { family: "ibm-plex-mono", weight: 400, size };
      for (const segmentPart of codeSegments(line)) {
        parts.push(
          t(cx, y + 18 + lineIndex * lineHeight, segmentPart.text, {
            font: MONO,
            size,
            fill: segmentPart.fill,
          }),
        );
        cx += measureText(segmentPart.text, spec);
      }
    });
    y += Math.max(metaHeight, codeHeight) + 14;
  });

  return frame({
    id: "contract-anatomy",
    title: "A profile document, block by block",
    lesson:
      "One document carries its own contract version, publication identity, site context, semantics, and every forecast hour.",
    description:
      "Excerpts of a real teaching profile: the schemaVersion and model identity, the run block, the sample-provenance site block with its timezone echo, the semantics tag, and the peak-W* hour's surface, first level, and derived blocks, quoted verbatim from the committed document.",
    caption: `Every fragment is stringified from the parsed committed profile at figure-generation time: these are the document's actual published values. The excerpted hour is hours[${hourIndex}] of ${profile.hours.length}; each hour repeats the surface/levels/derived shape.`,
    units: "heights m MSL · temperatures °C · wind m/s · pressure Pa",
    bodyWidth: codeX + codeWidth,
    bodyHeight: y - 14,
    body: parts.join("\n  "),
  });
}

async function composeDeriveSinkRate(ctx) {
  const { p50, usableLiftTopM } = await ctx.importPackage("briefing/derive");
  const { xForHour, yForAltitude, DEFAULT_OVERLAYS, TOKEN_DEFAULTS } =
    await ctx.importPackage("briefing/meteogram");
  const SINK_RATE_MS = 2.0;
  const overlays = onlyOverlays(
    DEFAULT_OVERLAYS,
    "boundaryLayerTop",
    "cloudBase",
    "usableLiftTop",
    "launch",
    "thermalStrength",
  );
  const rendered = await ctx.renderScene("convective-cycle", {
    idPrefix: "docs-derive-sink",
    overlays,
  });
  const { scene, profile } = rendered;

  const points = [];
  for (const hour of profile.hours) {
    const sceneIndex = scene.hourValidAts.indexOf(hour.validAt);
    if (sceneIndex < 0) continue;
    const boundaryLayerTopM = p50(hour.derived.boundaryLayerTopM);
    const thermalVelocityMps = p50(hour.derived.thermalVelocityMps);
    const cloudBaseM = p50(hour.derived.cloudBaseM);
    if (thermalVelocityMps === null || cloudBaseM === null) continue;
    const levels = hour.levels.flatMap((level) => {
      const heightM = p50(level.heightM);
      return heightM === null ? [] : [{ heightM }];
    });
    const inputs = {
      modelElevationM: profile.site.modelElevationM,
      boundaryLayerTopM,
      thermalVelocityMps,
      cloudBaseM,
      levels,
    };
    const projected = usableLiftTopM(inputs, SINK_RATE_MS);
    if (projected === null) continue;
    const publishedM = p50(hour.derived.usableLiftTopM);
    const reproduced = usableLiftTopM(inputs, 1.0);
    points.push({
      x: xForHour(scene, sceneIndex),
      y: yForAltitude(scene, projected),
      altitudeM: projected,
      publishedM,
      reproducedDeltaM:
        publishedM === null || reproduced === null ? null : Math.abs(reproduced - publishedM),
      local: hour.validAt.slice(11, 16),
    });
  }
  if (points.length === 0) {
    throw new Error(
      "[derive-sink] convective-cycle no longer yields a projected usable-lift series — re-choose this figure's scenario",
    );
  }
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
    .join(" ");
  const peak = points.reduce((best, point) => (point.altitudeM > best.altitudeM ? point : best));
  const maxParityDelta = Math.max(...points.map((point) => point.reproducedDeltaM ?? 0));
  const usableColour = TOKEN_DEFAULTS.usable ?? "#2179ad";

  const legendSpec = { family: "ibm-plex-mono", weight: 400, size: 11 };
  const legendText =
    `published series (1.0 m/s, pipeline authority) · projected at ${SINK_RATE_MS} m/s sink: ` +
    `a heavier wing climbs to ${localeRound(peak.altitudeM)} m instead of ` +
    `${peak.publishedM === null ? "null" : localeRound(peak.publishedM)} m at ${peak.local}`;
  const legendLines = wrapText(legendText, scene.width - 100, legendSpec);
  const legendTop = scene.height + 18;

  const body = `${mountChart(rendered, 0, 0)}
  <path d="${linePath}" fill="none" stroke="${ACCENT_STRONG}" stroke-width="2.2" stroke-dasharray="7 5"/>
  ${points
    .map(
      (point) =>
        `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="3.2" fill="${SURFACE}" stroke="${ACCENT_STRONG}" stroke-width="1.8"/>`,
    )
    .join("\n  ")}
  <text x="${round(peak.x)}" y="${round(peak.y - 10)}" text-anchor="middle" fill="${ACCENT_STRONG}" font-family="${MONO}" font-size="11" font-weight="700" stroke="${HALO}" stroke-width="3" paint-order="stroke">${escapeXml(`usableLiftTopM(inputs, ${SINK_RATE_MS}) -> ${localeRound(peak.altitudeM)} m`)}</text>
  <path d="M0 ${round(legendTop - 4)} h26" stroke="${usableColour}" stroke-width="3"/>
  <path d="M40 ${round(legendTop - 4)} h26" stroke="${ACCENT_STRONG}" stroke-width="3" stroke-dasharray="6 4"/>
  ${wrapped(78, legendTop, legendLines, { font: MONO, size: 11, fill: INK }, 16)}`;

  return frame({
    id: "derive-sink-rate",
    title: "One document, a second sink rate: no republication",
    lesson:
      "usableLiftTopM(inputs, sinkRateMps) projects the published inputs for another glider without replacing the stored default.",
    description: `A teaching Meteogram whose solid usable-lift line is the pipeline's stored 1.0 m/s series, overlaid with a dashed line recomputed at ${SINK_RATE_MS} m/s sink by the package's usableLiftTopM. At the peak hour the projection reaches ${localeRound(peak.altitudeM)} m against the published ${peak.publishedM === null ? "null" : localeRound(peak.publishedM)} m.`,
    caption: `The dashed series is computed at figure-generation time from the document's own published inputs (model elevation, boundary-layer top, W*, cloud base, level heights). Recomputed at the default 1.0 m/s, the same function reproduces the stored series within ${maxParityDelta.toFixed(1)} m of the contract-rounded published values.`,
    units: "heights m MSL · sink rate m/s · time UTC",
    bodyWidth: scene.width,
    bodyHeight: legendTop + (legendLines.length - 1) * 16 + 6,
    body,
  });
}

async function composeAnalyzeFindings(ctx) {
  const { analyzeForecast } = await ctx.importPackage("briefing/analyze");
  const { xForHour, yForAltitude } = await ctx.importPackage("briefing/meteogram");
  const rendered = await ctx.renderScene("convective-cycle", { idPrefix: "docs-analyze-findings" });
  const { scene, profile } = rendered;
  const meta = ctx.scenarioMeta("convective-cycle");
  const analysis = analyzeForecast(profile, { launch: meta.launch });

  const window = analysis.findings.find((finding) => finding.kind === "thermalWindow");
  if (!window) {
    throw new Error(
      "[analyze-findings] convective-cycle no longer yields a thermalWindow finding — re-choose this figure's scenario",
    );
  }
  const peakAboveLaunchM = window.peakLiftTopAboveLaunchM;
  if (peakAboveLaunchM === null) {
    throw new Error(
      "[analyze-findings] the thermalWindow finding lost its launch-relative peak — re-choose this figure's scenario",
    );
  }
  const startIndex = scene.hourValidAts.indexOf(window.start.validAt);
  const endIndex = scene.hourValidAts.indexOf(window.end.validAt);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error("[analyze-findings] the finding cites hours the scene did not render");
  }
  const half = scene.scales.columnWidth / 2;
  const bandLeft = xForHour(scene, startIndex) - half;
  const bandRight = xForHour(scene, endIndex) + half;
  const launchM = meta.launch.elevationM;
  const peak = {
    x: xForHour(scene, scene.hourValidAts.indexOf(window.peakLiftTopAt.validAt)),
    y: yForAltitude(scene, launchM + peakAboveLaunchM),
  };

  const capTiming = analysis.findings.find((finding) => finding.kind === "capTiming");
  const windSummary = analysis.findings.find((finding) => finding.kind === "windSummary");
  const dataCaveats = analysis.findings.find((finding) => finding.kind === "dataCaveats");

  const rows = [
    {
      term: "thermalWindow",
      text:
        `${localTime(window.start.local)}–${localTime(window.end.local)} local, peak ` +
        `${localeRound(peakAboveLaunchM)} m above launch at ${localTime(window.peakLiftTopAt.local)}; ` +
        `cites ${window.evidence.hours.length} source hours`,
    },
    ...(capTiming && capTiming.peakCapeAt
      ? [
          {
            term: "capTiming",
            text: `verdict ${capTiming.verdict}; peak CAPE ${localeRound(capTiming.peakCapeJkg)} J/kg at ${localTime(capTiming.peakCapeAt.local)}`,
          },
        ]
      : []),
    ...(windSummary?.maxGust
      ? [
          {
            term: "windSummary",
            text:
              `max gust ${windSummary.maxGust.gustMps} m/s at ${localTime(windSummary.maxGust.at.local)}` +
              (windSummary.maxGust.semantics ? ` (declared ${windSummary.maxGust.semantics})` : ""),
          },
        ]
      : []),
    ...(dataCaveats
      ? [
          {
            term: "dataCaveats",
            text: dataCaveats.caveats.map((entry) => entry.caveat).join(" · "),
          },
        ]
      : []),
  ];
  const ledger = ledgerRows(rows, scene.width, scene.height + 16);

  const plotTop = scene.scales.plotTop;
  const plotBottom = plotTop + scene.scales.plotHeight;
  const body = `${mountChart(rendered, 0, 0)}
  <rect x="${round(bandLeft)}" y="${round(plotTop)}" width="${round(bandRight - bandLeft)}" height="${round(scene.scales.plotHeight)}" fill="${ACCENT}" opacity="0.09"/>
  <line x1="${round(bandLeft)}" y1="${round(plotTop)}" x2="${round(bandLeft)}" y2="${round(plotBottom)}" stroke="${ACCENT_STRONG}" stroke-width="1.6" stroke-dasharray="5 4"/>
  <line x1="${round(bandRight)}" y1="${round(plotTop)}" x2="${round(bandRight)}" y2="${round(plotBottom)}" stroke="${ACCENT_STRONG}" stroke-width="1.6" stroke-dasharray="5 4"/>
  <rect x="${round(bandLeft)}" y="${round(plotTop)}" width="${round(bandRight - bandLeft)}" height="20" fill="${ACCENT}" opacity="0.92"/>
  ${t((bandLeft + bandRight) / 2, plotTop + 14, `thermalWindow ${localTime(window.start.local)}–${localTime(window.end.local)}`, { font: MONO, size: 11, weight: 700, fill: ACCENT_INK, anchor: "middle" })}
  <circle cx="${round(peak.x)}" cy="${round(peak.y)}" r="5" fill="none" stroke="${ACCENT_STRONG}" stroke-width="2"/>
  <text x="${round(peak.x)}" y="${round(peak.y - 10)}" text-anchor="middle" fill="${ACCENT_STRONG}" font-family="${MONO}" font-size="11" font-weight="700" stroke="${HALO}" stroke-width="3" paint-order="stroke">${escapeXml(`peak ${localeRound(peakAboveLaunchM)} m above launch`)}</text>
  ${ledger.markup}`;

  return frame({
    id: "analyze-findings",
    title: "Findings, drawn on the document they cite",
    lesson:
      "Each finding carries the thresholds that produced it and the instants it cites, so it can be drawn back onto its source hours.",
    description: `A teaching Meteogram with the thermalWindow finding computed by analyzeForecast overlaid as a highlighted band from ${localTime(window.start.local)} to ${localTime(window.end.local)}, and the day's other findings listed with their evidence values.`,
    caption: `The band and every number below are computed at figure-generation time by analyzeForecast on this committed profile with the default thresholds (W* at least ${window.thresholds.wstarMinMps} m/s, depth at least ${window.thresholds.depthMinM} m above launch). Nothing in this figure is hand-written.`,
    units: "time UTC · heights m MSL · W* m/s",
    bodyWidth: scene.width,
    bodyHeight: scene.height + 16 + ledger.height,
    body,
  });
}

async function composeCompareAgreement(ctx) {
  const { compareForecasts } = await ctx.importPackage("briefing/compare");
  const { siteForecastSchema } = await ctx.importPackage("briefing/contract");
  const { DEFAULT_OVERLAYS } = await ctx.importPackage("briefing/meteogram");
  const meta = ctx.scenarioMeta("model-timing-disagreement");

  const relabel = (profile, model) => siteForecastSchema.parse({ ...profile, model });
  const earlier = await ctx.loadProfile("model-timing-disagreement", "earlier");
  const later = await ctx.loadProfile("model-timing-disagreement", "later");
  const members = [relabel(earlier, "timing-earlier"), relabel(later, "timing-later")];
  const comparison = compareForecasts(members, { timeZone: meta.timeZone, launch: meta.launch });
  const agreement = comparison.findings.find((finding) => finding.kind === "windowAgreement");
  if (!agreement) {
    throw new Error(
      "[compare-agreement] the timing pair no longer yields a windowAgreement finding — re-choose this figure's scenario",
    );
  }
  const heightSpread = comparison.findings.find((finding) => finding.kind === "heightSpread");

  const overlays = onlyOverlays(
    DEFAULT_OVERLAYS,
    "thermalStrength",
    "boundaryLayerTop",
    "usableLiftTop",
    "launch",
    "selectedHour",
  );
  const options = { overlays, columnWidthPx: 56, plotHeightPx: 280 };
  const panels = [];
  for (const [variant, slug] of [
    ["earlier", "timing-earlier"],
    ["later", "timing-later"],
  ]) {
    const output = meta.outputs.find((entry) => entry.variant === variant);
    const rendered = await ctx.renderScene("model-timing-disagreement", {
      variant,
      idPrefix: `docs-compare-${variant}`,
      ...options,
    });
    panels.push({
      slug,
      label: output.title,
      rendered,
      vote: agreement.windows.find((vote) => vote.model === slug) ?? null,
    });
  }

  const gap = 20;
  const headerHeight = 28;
  const voteHeight = 24;
  const panelWidth = Math.max(...panels.map((panel) => panel.rendered.scene.width)) + 2;
  const chartHeight = Math.max(...panels.map((panel) => panel.rendered.scene.height));
  const panelHeight = headerHeight + chartHeight + voteHeight + 2;

  const panelMarkup = panels
    .map((panel, index) => {
      const x = index * (panelWidth + gap);
      const slugSpec = { family: "ibm-plex-mono", weight: 700, size: 11.5 };
      const vote = panel.vote
        ? `window ${localTime(panel.vote.start.local)}–${localTime(panel.vote.end.local)} · peak at ${localTime(panel.vote.peakLiftTopAt.local)}` +
          (panel.vote.clippedAtStart ? " · start clipped" : "") +
          (panel.vote.clippedAtEnd ? " · end clipped" : "")
        : "";
      return `<g transform="translate(${round(x)} 0)">
    <rect x="0" y="0" width="${round(panelWidth)}" height="${round(panelHeight)}" fill="${SURFACE}" stroke="${RULE}"/>
    ${t(10, 19, panel.slug, { font: MONO, size: 11.5, weight: 700, fill: ACCENT_STRONG })}
    ${t(18 + measureText(panel.slug, slugSpec), 19, panel.label, { font: MONO, size: 11.5, fill: INK_SOFT })}
    <path d="M0 ${headerHeight} h${round(panelWidth)}" stroke="${RULE}"/>
    ${mountChart(panel.rendered, 1, headerHeight + 1)}
    <path d="M0 ${headerHeight + chartHeight + 1} h${round(panelWidth)}" stroke="${RULE}"/>
    ${t(10, headerHeight + chartHeight + 17, vote, { font: MONO, size: 11, fill: INK })}
  </g>`;
    })
    .join("\n  ");

  const bodyWidth = panelWidth * 2 + gap;
  const rows = [
    {
      term: "windowAgreement",
      text:
        `${agreement.windows.length} of ${agreement.voters} voters report a window` +
        `${agreement.unanimous ? " · unanimous" : ""}; start spread ` +
        `${JSON.stringify(agreement.timing.startSpreadHours)} (clipped edges abstain)`,
    },
    ...(heightSpread
      ? [
          {
            term: "heightSpread",
            text:
              `${heightSpread.spreadM} m between peaks the models place ` +
              `${heightSpread.peaks.map((entry) => `at ${localTime(entry.at.local)}`).join(" and ")}` +
              ": the same height, two hours apart, stated without a consensus",
          },
        ]
      : []),
  ];
  const ledger = ledgerRows(rows, bodyWidth, panelHeight + 18);

  return frame({
    id: "compare-agreement",
    title: "Two models, one verdict, evidence attached",
    lesson: meta.lesson,
    description: `Two controlled profiles with the same daytime development at different hours, rendered side by side, with the windowAgreement finding compareForecasts computed from them: ${agreement.voters} voters, unanimous ${String(agreement.unanimous)}.`,
    caption:
      "Charts and verdict are computed at figure-generation time from the committed comparison pair (re-slugged so each document keeps its own analysis). An edge clipped by a document's horizon reads as \"open since at least\" and stays out of the timing spread, which is why this pair's start spread is reported as null rather than a number no model stated.",
    units: "time UTC · heights m MSL · W* m/s",
    bodyWidth,
    bodyHeight: panelHeight + 18 + ledger.height,
    body: `${panelMarkup}\n  ${ledger.markup}`,
  });
}

async function composeFirstMeteogram(ctx) {
  const { buildKeySpec, renderKeySvg } = await ctx.importPackage("briefing/meteogram");
  const rendered = await ctx.renderScene("convective-cycle", { idPrefix: "docs-first-meteogram" });
  const { scene } = rendered;
  const meta = ctx.scenarioMeta("convective-cycle");

  const keySvg = renderKeySvg(buildKeySpec(scene), { idPrefix: "docs-first-meteogram-key" });
  const keyViewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(keySvg);
  if (!keyViewBox) throw new Error("[first-meteogram] the rendered key has no viewBox");
  const key = { svg: keySvg, width: Number(keyViewBox[1]), height: Number(keyViewBox[2]) };

  const keyTop = scene.height + 16;
  const body = `${mountChart(rendered, 0, 0)}
  ${placeChart(key, { x: 0, y: keyTop, width: key.width }).markup}`;

  return frame({
    id: "first-meteogram",
    title: "The chart and key this page's code produces",
    lesson: meta.lesson,
    description:
      "A complete teaching Meteogram and the key derived from its final scene, exactly as the page's twelve-line example serializes them.",
    caption:
      "Rendered by the released package: validate, build a scene, serialize the chart, then derive the key from that final scene. Swap the committed teaching profile for your published one and the code below is the whole program.",
    units:
      "altitude m and ft · wind km/h · temperature °C · pressure kPa · precipitation mm/h · w* m/s",
    bodyWidth: Math.max(scene.width, key.width),
    bodyHeight: keyTop + key.height,
    body,
  });
}

async function composeSceneAnatomy(ctx) {
  const { xForHour } = await ctx.importPackage("briefing/meteogram");
  const rendered = await ctx.renderScene("convective-cycle", { idPrefix: "docs-scene-anatomy" });
  const { scene } = rendered;

  const s = scene.scales;
  const plotBottom = s.plotTop + s.plotHeight;
  const stripTops = scene.strips.map((strip) => strip.top);
  const firstStripTop = stripTops.length > 0 ? Math.min(...stripTops) : scene.height;
  const stripsBottom = scene.strips.reduce(
    (bottom, strip) => Math.max(bottom, strip.top + strip.height),
    firstStripTop,
  );
  const stripKeys = scene.strips.map((strip) => strip.key).join(" · ");
  const selectedX = xForHour(scene, scene.selectedHourIndex);

  const regions = [
    {
      n: 1,
      x: s.plotLeft,
      y: s.plotTop,
      w: s.plotWidth,
      h: s.plotHeight,
      name: "Time–height plot",
      source: "scene.fields · scene.series · scene.barbs · scene.markers · scene.gusts",
      detail: "interpolated iso-band fields, derived-height lines, wind barbs, marker trains",
    },
    {
      n: 2,
      x: 3,
      y: s.plotTop,
      w: s.plotLeft - 6,
      h: s.plotHeight,
      name: "Altitude axes",
      source: "scene.axes.altitude · scene.axes.pressureAltitude",
      detail:
        "each tick carries y, labelMetres, and labelFeet; pressure ticks carry median level heights",
    },
    {
      n: 3,
      x: s.plotLeft,
      y: plotBottom + 2,
      w: s.plotWidth,
      h: Math.max(14, firstStripTop - plotBottom - 6),
      name: "Hour labels and surface row",
      source: "scene.axes.hours · scene.surfaceTemperatures",
      detail: "local hour ticks (hourLabel option) and the per-hour rounded temperature readout",
    },
    {
      n: 4,
      x: s.plotLeft,
      y: firstStripTop,
      w: s.plotWidth,
      h: stripsBottom - firstStripTop,
      name: "Metric strips",
      source: `scene.strips[] (${stripKeys})`,
      detail: "one MetricStrip per row with top, height, min/max, and line/area/band paths",
    },
  ];

  const legendEntries = [
    ...regions.map((region) => ({
      n: region.n,
      text: `${region.name} · ${region.source}: ${region.detail}`,
    })),
    ...(scene.launch
      ? [
          {
            n: 5,
            text: `Launch line · scene.launch: y, altitude, and label for the launch supplied at render time via MeteogramOptions.launch (${scene.launch.label})`,
          },
        ]
      : []),
    {
      n: 6,
      text: "Selected hour · scene.selectedHourIndex: the day's peak-W* column, highlighted by the selectedHour overlay",
    },
  ];
  const legend = legendRows(legendEntries, scene.width, scene.height + 16);

  const body = `${mountChart(rendered, 0, 0)}
  ${regions
    .map(
      (
        region,
      ) => `<rect x="${round(region.x)}" y="${round(region.y)}" width="${round(region.w)}" height="${round(region.h)}" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.6" stroke-dasharray="6 4"/>
  ${chip(region.x + 13, region.y + 13, region.n)}`,
    )
    .join("\n  ")}
  ${scene.launch ? chip(s.plotLeft + s.plotWidth - 14, scene.launch.y, 5) : ""}
  ${chip(selectedX, s.plotTop + s.plotHeight - 14, 6)}
  ${legend.markup}`;

  return frame({
    id: "scene-anatomy",
    title: "One scene graph, mapped onto its own pixels",
    lesson:
      "buildMeteogramScene returns pure data; every region of the rendered chart is a named collection on that data.",
    description:
      "A rendered teaching Meteogram with outlined regions naming the MeteogramScene collections that draw them: the time–height plot (fields, series, barbs, markers), the altitude axes, the hour-label and surface-temperature row, the metric strips, the launch line, and the selected-hour column.",
    caption:
      "Region boxes are positioned from this scene's own scales and strip geometry at figure-generation time: scene.scales places the plot, each MetricStrip carries its top and height, and the launch line and selected hour are scene fields, not renderer guesses. The launch itself is a render input (MeteogramOptions.launch, supplied at render time); the document carries none.",
    units: "scene px · altitude m and ft · time UTC",
    bodyWidth: scene.width,
    bodyHeight: scene.height + 16 + legend.height,
    body,
  });
}

async function composeInspectorSelection(ctx) {
  const { drawnBarbsForHour, xForHour } = await ctx.importPackage("briefing/meteogram");

  const probe = (await ctx.renderScene("convective-cycle", { idPrefix: "docs-inspector-probe" }))
    .scene;
  const hourIndex = Math.max(0, probe.selectedHourIndex - 2);
  const ladder = drawnBarbsForHour(probe, hourIndex);
  const target = ladder[Math.min(ladder.length - 1, 2)] ?? ladder[0];

  const rendered = await ctx.renderScene("convective-cycle", {
    idPrefix: "docs-inspector-selection",
    selection: { hourIndex, altitudeM: target?.altitudeM },
  });
  const { scene } = rendered;
  const selection = scene.selection;
  if (!selection)
    throw new Error("[inspector-selection] the rebuilt scene did not resolve the selection");
  const bestX = xForHour(scene, scene.selectedHourIndex);

  const chips = [
    { n: 1, x: selection.centerX, y: selection.top + 13 },
    { n: 2, x: selection.centerX, y: selection.bottom - 14 },
    ...(selection.barb ? [{ n: 3, x: selection.barb.x + 24, y: selection.barb.y }] : []),
  ];

  const legendEntries = [
    {
      n: 1,
      text: "Selection column · scene.selection.x · width · top · bottom: the tinted column and its span, strips to plot floor (meteo-gram-selection-column)",
    },
    {
      n: 2,
      text: "Hairline · scene.selection.centerX: the column-centre time line (meteo-gram-selection-line)",
    },
    ...(selection.barb
      ? [
          {
            n: 3,
            text: "Barb ring · scene.selection.barb: the requested altitude snapped to the nearest drawn barb, ringed at its drawn position (meteo-gram-selection-ring, themed by --meteo-gram-selection)",
          },
        ]
      : []),
    {
      n: 4,
      muted: true,
      text: "Not the selection · scene.selectedHourIndex: the scene's own computed peak-W* highlight, a different fact with its own toggle",
    },
  ];
  const legend = legendRows(legendEntries, scene.width, scene.height + 16);

  const body = `${mountChart(rendered, 0, 0)}
  ${chips.map((entry) => chip(entry.x, entry.y, entry.n)).join("\n  ")}
  ${chip(bestX, selection.top + 13, 4, { fill: INK_MUTE })}
  ${legend.markup}`;

  return frame({
    id: "inspector-selection",
    title: "A selection the scene resolved and the serializer drew",
    lesson:
      "Pass selection to buildMeteogramScene and the reference render marks it: the inspector and the pixels share one authority.",
    description: `A rendered teaching Meteogram whose build received selection: { hourIndex: ${selection.hourIndex}, altitudeM: ${Math.round(target?.altitudeM ?? 0)} }. The serializer drew the tinted selection column with its centre hairline, and a ring on the drawn wind barb the requested altitude snapped to. The scene's own computed best-hour highlight is visible on a different column.`,
    caption: `scene.selection resolved the ring to the drawn barb at ${Math.round(selection.barb?.altitudeM ?? 0)} m, the nearest DRAWN barb to the request, the same answer nearestDrawnBarb gives. The paler highlight at hour ${scene.selectedHourIndex} is scene.selectedHourIndex, the computed peak-W* column: the two marks are different facts.`,
    units: "scene px · altitude m",
    bodyWidth: scene.width,
    bodyHeight: scene.height + 16 + legend.height,
    body,
  });
}

const CLUB_TOKENS = {
  surface: "#14181c",
  "strip-bg": "#1b2126",
  ink: "#e8e4da",
  "ink-soft": "#c9c3b4",
  "ink-mute": "#a29a89",
  rule: "#5a6672",
  temp: "#d97706",
  halo: "#14181c",
  "halo-barb": "#0d1114",
};

function clubify(svg) {
  let out = svg.replaceAll("meteo-gram", "meteo-club");
  for (const [name, value] of Object.entries(CLUB_TOKENS)) {
    out = out.replace(
      new RegExp(`var\\(--meteo-club-${name},\\s*[^)]+\\)`, "g"),
      `var(--meteo-club-${name}, ${value})`,
    );
  }
  return out;
}

/* This plate DEMONSTRATES the token override, so its two chart panels must
   not themselves follow the page the plate sits on: each panel's tokens are
   resolved to literals — package defaults on the left, the club palette on
   the right — and only the frame around them stays page-chrome. */
function pinTokens(svg, prefix = "meteo-gram") {
  const reference = new RegExp(`var\\(--${prefix}-[\\w-]+,\\s*([^)]+)\\)`, "g");
  /* Fallbacks can themselves be var() references (the per-element halo
     tokens fall back through --meteo-gram-halo); each pass peels one level. */
  let out = svg;
  let previous;
  do {
    previous = out;
    out = out.replace(reference, "$1");
  } while (out !== previous);
  return out;
}

async function composeTokenContrast(ctx) {
  const { DEFAULT_OVERLAYS } = await ctx.importPackage("briefing/meteogram");
  const overlays = onlyOverlays(
    DEFAULT_OVERLAYS,
    "temperature",
    "clouds",
    "boundaryLayerTop",
    "cloudBase",
    "usableLiftTop",
    "launch",
    "thermalStrength",
    "pressure",
  );
  const options = { overlays, columnWidthPx: 52, plotHeightPx: 280 };
  const left = await ctx.renderScene("convective-cycle", {
    idPrefix: "docs-tokens-default",
    ...options,
  });
  const right = await ctx.renderScene("convective-cycle", {
    idPrefix: "docs-tokens-club",
    ...options,
  });
  const leftSvg = pinTokens(left.svg);
  const rightSvg = pinTokens(clubify(right.svg), "meteo-club");

  const gap = 20;
  const headerHeight = 26;
  const panelWidth = left.scene.width + 2;
  const panelHeight = headerHeight + left.scene.height + 2;

  const panel = (x, title, chartMarkup) => `<g transform="translate(${round(x)} 0)">
    <rect x="0" y="0" width="${round(panelWidth)}" height="${round(panelHeight)}" fill="${SURFACE}" stroke="${RULE}"/>
    ${t(10, 17, title, { font: MONO, size: 11, weight: 600, fill: INK_SOFT })}
    <path d="M0 ${headerHeight} h${round(panelWidth)}" stroke="${RULE}"/>
    ${chartMarkup}
  </g>`;

  const leftChart = placeChart(
    { svg: leftSvg, width: left.scene.width, height: left.scene.height },
    { x: 1, y: headerHeight + 1, width: left.scene.width },
  ).markup;
  const rightChart = placeChart(
    { svg: rightSvg, width: right.scene.width, height: right.scene.height },
    { x: 1, y: headerHeight + 1, width: right.scene.width },
  ).markup;

  const body = `${panel(0, "package defaults", leftChart)}
  ${panel(panelWidth + gap, "ancestor overrides --meteo-gram-*", rightChart)}`;

  return frame({
    id: "token-contrast",
    title: "Same scene, same bytes: two token sets",
    lesson:
      "Palette is not scene data: a downstream look is CSS custom properties on an ancestor, never a forked serializer.",
    description:
      "The same teaching Meteogram rendered twice from one scene. The left panel uses the package's default tokens; the right panel resolves the same markup with surface, ink, temperature, and halo tokens overridden to a dark club palette. The scene geometry of both panels is identical.",
    caption:
      "Both panels serialize the same DEFAULT_STYLESHEET; the right panel only swaps the resolved values of --meteo-gram-surface, --meteo-gram-strip-bg, --meteo-gram-ink, --meteo-gram-ink-soft, --meteo-gram-ink-mute, --meteo-gram-rule, --meteo-gram-temp, --meteo-gram-halo, and --meteo-gram-halo-barb: the ancestor-override path the page documents. In this committed plate each panel is pinned to its resolved values, so the demonstration itself never restyles with the page around it.",
    units: "altitude m and ft · time UTC",
    bodyWidth: panelWidth * 2 + gap,
    bodyHeight: panelHeight,
    body,
  });
}

async function composeTokenReference(ctx) {
  const { DEFAULT_CAPE_CLASSES, DEFAULT_OVERLAYS, STABILITY_TOKEN_DEFAULTS, TOKEN_DEFAULTS } =
    await ctx.importPackage("briefing/meteogram");

  const isColor = (value) => value.startsWith("#") || value === "transparent";
  const tokens = Object.entries(TOKEN_DEFAULTS);
  const stability = Object.entries(STABILITY_TOKEN_DEFAULTS);
  const overlaysOn = Object.entries(DEFAULT_OVERLAYS)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const overlaysOff = Object.entries(DEFAULT_OVERLAYS)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);

  const width = 940;
  const columns = 3;
  const colWidth = (width - (columns - 1) * 18) / columns;
  const monoName = { family: "ibm-plex-mono", weight: 400, size: 10 };

  const truncate = (value, maxWidth) => {
    if (measureText(value, monoName) <= maxWidth) return value;
    let text = value;
    while (text.length > 1 && measureText(`${text}…`, monoName) > maxWidth)
      text = text.slice(0, -1);
    return `${text}…`;
  };

  const swatchEntry = (x, y, name, value) => {
    const parts = [];
    if (isColor(value)) {
      parts.push(
        `<rect x="${round(x)}" y="${round(y)}" width="14" height="14" fill="${value === "transparent" ? SURFACE : value}" stroke="${RULE}"/>`,
      );
    } else {
      parts.push(
        `<rect x="${round(x)}" y="${round(y)}" width="14" height="14" fill="${SURFACE}" stroke="${RULE}"/>`,
      );
      parts.push(
        t(x + 7, y + 10.5, "Aa", {
          font: MONO,
          size: 6.5,
          weight: 700,
          fill: INK_MUTE,
          anchor: "middle",
        }),
      );
    }
    const nameWidth = measureText(name, monoName);
    parts.push(t(x + 22, y + 11, name, { font: MONO, size: 10, fill: INK }));
    const valueMax = colWidth - 22 - nameWidth - 18;
    parts.push(
      t(x + colWidth - 6, y + 11, truncate(value, Math.max(valueMax, 60)), {
        font: MONO,
        size: 10,
        fill: INK_MUTE,
        anchor: "end",
      }),
    );
    return parts.join("\n  ");
  };

  const grid = (entries, top) => {
    const rows = Math.ceil(entries.length / columns);
    const parts = [];
    entries.forEach(([name, value], index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      parts.push(swatchEntry(column * (colWidth + 18), top + row * 22, name, value));
    });
    return { markup: parts.join("\n  "), height: rows * 22 };
  };

  const heading = (y, text) => t(0, y, text, { size: 13, weight: 700 });
  const parts = [];
  let y = 12;

  parts.push(heading(y, `Stability ramp: STABILITY_TOKEN_DEFAULTS`));
  y += 12;
  const ramp = grid(stability, y);
  parts.push(ramp.markup);
  y += ramp.height + 22;

  parts.push(heading(y, "Scene defaults: DEFAULT_CAPE_CLASSES · DEFAULT_OVERLAYS"));
  y += 18;
  const lineSpec = { family: "ibm-plex-mono", weight: 400, size: 10.5 };
  const sceneLines = [
    `CAPE strip classes: watch from ${DEFAULT_CAPE_CLASSES.watchJkg}, risk from ${DEFAULT_CAPE_CLASSES.riskJkg}, severe from ${DEFAULT_CAPE_CLASSES.severeJkg} J/kg; a cell dims when CIN is at or below ${DEFAULT_CAPE_CLASSES.cappedCinJkg} J/kg.`,
    `Overlays defaulting on (${overlaysOn.length}): ${overlaysOn.join(", ")}.`,
    `Defaulting off (${overlaysOff.length}): ${overlaysOff.join(", ")}.`,
  ].flatMap((line) => wrapText(line, width, lineSpec));
  parts.push(wrapped(0, y, sceneLines, { font: MONO, size: 10.5, fill: INK_SOFT }, 15));
  y += sceneLines.length * 15 + 16;

  parts.push(heading(y, `Renderer tokens: TOKEN_DEFAULTS (${tokens.length})`));
  y += 12;
  const tokenGrid = grid(tokens, y);
  parts.push(tokenGrid.markup);
  y += tokenGrid.height;

  return frame({
    id: "token-reference",
    title: "Every default, read from the package",
    lesson:
      "Token keys omit the CSS prefix: surface maps to --meteo-gram-surface, stable to --meteo-gram-stab-stable.",
    description: `The package's exported defaults rendered as swatches and values: the ${stability.length}-class stability ramp, all ${tokens.length} renderer tokens, the CAPE class thresholds, and which of the ${overlaysOn.length + overlaysOff.length} overlays default on.`,
    caption:
      "Rendered at figure-generation time from TOKEN_DEFAULTS, STABILITY_TOKEN_DEFAULTS, DEFAULT_CAPE_CLASSES, and DEFAULT_OVERLAYS. A release that changes any default changes this figure with it.",
    units: "colors hex · type sizes px · CAPE J/kg",
    bodyWidth: width,
    bodyHeight: y,
    body: parts.join("\n  "),
  });
}

async function composePlatformBoundary() {
  const width = 980;
  const leftX = 0;
  const leftW = 600;
  const leftCx = leftX + leftW / 2;
  const rightX = 650;
  const rightW = width - rightX;
  const rightCx = rightX + rightW / 2;
  const titleSpec = { family: "ibm-plex-sans", weight: 700, size: 14 };
  const detailSpec = { family: "ibm-plex-sans", weight: 400, size: 12.5 };

  const parts = [];
  parts.push(flowMarker("platform-boundary-flow"));

  function box(x, w, y, title, detail, { accent = false } = {}) {
    const cx = x + w / 2;
    const titleLines = wrapText(title, w - 26, titleSpec);
    const detailLines = wrapText(detail, w - 26, detailSpec);
    const h = 16 + titleLines.length * 18 + 4 + detailLines.length * 17 + 10;
    parts.push(
      `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="8" fill="${accent ? SURFACE_ACCENT : SURFACE}" stroke="${accent ? ACCENT : RULE_STRONG}" stroke-width="2"/>`,
    );
    let ty = y + 16 + 12;
    for (const line of titleLines) {
      parts.push(t(cx, ty - 12 + 4, line, { font: MONO, size: 14, weight: 700, anchor: "middle" }));
      ty += 18;
    }
    ty += 2;
    for (const line of detailLines) {
      parts.push(t(cx, ty - 12 + 2, line, { size: 12.5, fill: INK_SOFT, anchor: "middle" }));
      ty += 17;
    }
    return y + h;
  }

  function arrow(cx, fromY, toY) {
    parts.push(
      `<path d="M${round(cx)} ${round(fromY)} V${round(toY - 3)}" stroke="${INK_SOFT}" stroke-width="2" marker-end="url(#platform-boundary-flow)"/>`,
    );
  }

  const sourceY = 14;
  parts.push(
    t(leftCx, sourceY, "provider model files: GRIB2 · JPEG 2000", {
      font: MONO,
      size: 12,
      fill: INK_MUTE,
      anchor: "middle",
    }),
  );
  parts.push(
    t(rightCx, sourceY, "weather-station hardware", {
      font: MONO,
      size: 12,
      fill: INK_MUTE,
      anchor: "middle",
    }),
  );

  let y = sourceY + 12;
  arrow(leftCx, y, y + 16);
  const decodersBottom = box(
    leftX + 20,
    leftW - 40,
    y + 18,
    "@azohra/meteo.grib · @azohra/meteo.j2k",
    "Decode provider bytes into typed grids, gated bit-for-bit against ecCodes.",
  );
  arrow(leftCx, decodersBottom, decodersBottom + 16);
  const engineBottom = box(
    leftX + 20,
    leftW - 40,
    decodersBottom + 18,
    "@azohra/meteo.forecast",
    "Samples each launch, derives engine-owned values, publishes documents.",
  );

  arrow(leftCx, engineBottom, engineBottom + 16);
  const boundaryY = engineBottom + 18;
  const boundaryH = 46;
  parts.push(
    `<rect x="${leftX}" y="${round(boundaryY)}" width="${leftW}" height="${boundaryH}" fill="${SURFACE_SUNKEN}" stroke="${INK}" stroke-width="2"/>`,
  );
  parts.push(
    t(leftCx, boundaryY + 19, "VERSIONED JSON DOCUMENTS", {
      font: MONO,
      size: 12.5,
      weight: 700,
      ls: 0.5,
      fill: ACCENT_STRONG,
      anchor: "middle",
    }),
  );
  parts.push(
    t(leftCx, boundaryY + 36, "manifest · site profiles · month archives · site context", {
      font: MONO,
      size: 11,
      fill: INK_SOFT,
      anchor: "middle",
    }),
  );
  const boundaryBottom = boundaryY + boundaryH;

  arrow(leftCx, boundaryBottom, boundaryBottom + 16);
  const readerY = boundaryBottom + 18;
  const briefingBottom = box(
    leftX + 20,
    leftW - 40,
    readerY,
    "@azohra/meteo.briefing",
    "Validates the documents, derives, analyzes, compares, draws the Meteogram.",
  );

  // The station lane never crosses the forecast-document boundary: adapters
  // read vendor hardware feeds and serve the capability's own live wire.
  arrow(rightCx, sourceY + 12, readerY);
  const stationBottom = box(
    rightX + 6,
    rightW - 12,
    readerY,
    "@azohra/meteo.station",
    "Adapters, feed handler, and display over its own live wire contract.",
  );

  const readersBottom = Math.max(briefingBottom, stationBottom);
  const coreY = readersBottom + 14;
  const downstreamY = coreY + 46;
  // Arrows first, then the core bar on a solid ground, so the shared
  // foundation reads as a layer the lanes pass beneath.
  arrow(leftCx, readersBottom, downstreamY);
  arrow(rightCx, readersBottom, downstreamY);
  parts.push(
    `<rect x="${leftX + 20}" y="${round(coreY)}" width="${width - 40}" height="30" rx="6" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-dasharray="5 4" stroke-width="1.5"/>`,
  );
  parts.push(
    t(
      width / 2,
      coreY + 19,
      "@azohra/meteo.core: units · one wind sign · failure vocabulary (imported by briefing and station)",
      {
        font: MONO,
        size: 11.5,
        fill: INK_SOFT,
        anchor: "middle",
      },
    ),
  );
  parts.push(`<path d="M0 ${round(downstreamY + 2)} h${width}" stroke="${INK}" stroke-width="2"/>`);
  parts.push(
    t(0, downstreamY + 22, "THE OPERATOR", {
      font: MONO,
      size: 12,
      weight: 700,
      ls: 0.5,
      fill: ACCENT_STRONG,
    }),
  );
  parts.push(
    t(width, downstreamY + 22, "hosting · schedule · access · presentation · safety language", {
      font: MONO,
      size: 12,
      fill: INK_MUTE,
      anchor: "end",
    }),
  );

  return frame({
    id: "platform-boundary",
    title: "Responsibility by layer",
    lesson:
      "An engine publishes versioned JSON; packages read what it published. Station reads live hardware over its own wire and never crosses that boundary.",
    description:
      "Two lanes. Left: provider model files decode through the grib and j2k packages, the forecast engine publishes versioned JSON documents, and the briefing package reads them. Right: weather-station hardware feeds the station package directly. Both lanes end at the operator, who publishes for their audience. A dashed bar marks the core package's shared vocabulary beneath briefing and station.",
    caption:
      "Every layer runs on infrastructure its operator controls. The versioned documents are the data boundary between publisher and consumer; the operator owns everything their readers see around them.",
    units: "layer diagram; no numeric scale",
    bodyWidth: width,
    bodyHeight: downstreamY + 30,
    body: parts.join("\n  "),
  });
}

/* Deterministic PRNG and scatter, mirroring j2k/test/region.test.ts so the
   figure reproduces the committed bench's exact point sets (seed 0xc0ffee). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function benchScatter(width, height, count, seed) {
  const rand = mulberry32(seed);
  const indices = new Set();
  while (indices.size < count) {
    indices.add(Math.floor(rand() * height) * width + Math.floor(rand() * width));
  }
  return [...indices];
}

async function composeRegionDecode(ctx) {
  const { parseFields, splitMessages } = await ctx.importPackage("grib");
  const { decodeJ2kRegion, decodeRegionFromPlan, planDecode } = await ctx.importPackage("j2k");
  const fixturePath = join(ctx.root, "grib", "test", "fixtures", "hrdps-continental-tmp-2m.grib2");
  const field = parseFields(splitMessages(new Uint8Array(readFileSync(fixturePath)))[0])[0];
  /* Section 7's body (past its 5-octet header) is the raw JPEG 2000
     codestream a DRT 5.40 field carries. */
  const codestream = field.section7.subarray(5);
  const plan = planDecode(codestream);
  const { width, height } = plan.header;
  const samples = width * height;
  const levels = plan.header.decompositionLevels;

  const series = [1, 4, 16, 64, 256].map((count) => {
    const result = decodeJ2kRegion(codestream, benchScatter(width, height, count, 0xc0ffee));
    return { count, decoded: result.codeblocksDecoded, total: result.codeblocksTotal };
  });
  const total = series[0].total;
  const four = series.find((entry) => entry.count === 4);

  /* The touched SET: decodeRegionFromPlan reads a task's byteOffset exactly
     once per entropy-decoded codeblock, so instrumented tasks record the
     exact blocks the decode consumed — no selection logic reimplemented. */
  const indices = benchScatter(width, height, 4, 0xc0ffee);
  const touched = new Set();
  const instrumented = plan.tasks.map((task, id) => ({
    ...task,
    get byteOffset() {
      touched.add(id);
      return task.byteOffset;
    },
  }));
  const region = decodeRegionFromPlan(codestream, { ...plan, tasks: instrumented }, indices);
  if (touched.size !== region.codeblocksDecoded || region.codeblocksDecoded !== four.decoded) {
    throw new Error(
      "[region-decode] the instrumented touched set disagrees with codeblocksDecoded",
    );
  }
  const points = indices.map((index) => ({ x: index % width, y: Math.floor(index / width) }));

  /* ── Panel A: the request, in image space ── */
  const aX = 24;
  const aTop = 56;
  const k2 = 340 / width;
  const aH = round(height * k2);
  const imagePanel = [
    `<rect x="${aX}" y="${aTop}" width="340" height="${aH}" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  ];
  points.forEach((point, index) => {
    const x = aX + point.x * k2;
    const y = aTop + point.y * k2;
    imagePanel.push(
      `<path d="M${round(x - 5)} ${round(y)} h10 M${round(x)} ${round(y - 5)} v10" stroke="${ACCENT_STRONG}" stroke-width="1.6"/>`,
    );
    const labelY = y < aTop + 16 ? y + 16 : y - 8;
    imagePanel.push(
      t(x + 7, labelY, String(index + 1), {
        font: MONO,
        size: 10,
        weight: 700,
        fill: ACCENT_STRONG,
      }),
    );
  });
  imagePanel.push(
    t(aX, aTop + aH + 18, `${width} × ${height} = ${samples.toLocaleString("en-CA")} samples`, {
      font: MONO,
      size: 10,
      fill: INK_SOFT,
    }),
  );
  imagePanel.push(
    t(aX, aTop + aH + 33, points.map((p, i) => `${i + 1} (${p.x}, ${p.y})`).join(" · "), {
      font: MONO,
      size: 9.5,
      fill: INK_MUTE,
    }),
  );
  const statTop = aTop + aH + 66;
  imagePanel.push(
    t(aX, statTop, `${four.decoded} of ${total}`, {
      font: DISPLAY,
      size: 34,
      weight: 800,
      ls: 0.3,
    }),
  );
  imagePanel.push(
    t(
      aX,
      statTop + 22,
      `codeblocks entropy-decoded · ${((four.decoded / total) * 100).toFixed(1)} %`,
      {
        font: MONO,
        size: 11,
        fill: INK_SOFT,
      },
    ),
  );
  imagePanel.push(
    t(aX, statTop + 40, "values bit-identical to the full decode", {
      font: MONO,
      size: 10.5,
      fill: INK_MUTE,
    }),
  );

  /* ── Panel B: every codeblock in the tile buffer, touched ones hatched ── */
  const mX = 386;
  const mTop = 56;
  const k = 590 / width;
  const mW = round(width * k);
  const mH = round(height * k);
  const map = [];
  map.push(`<defs><pattern id="region-decode-hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <rect width="5" height="5" fill="${ACCENT}"/>
    <path d="M0 0V5" stroke="${ACCENT_STRONG}" stroke-width="1.5"/>
  </pattern></defs>`);
  map.push(`<rect x="${mX}" y="${mTop}" width="${mW}" height="${mH}" fill="${SURFACE}"/>`);
  const blockRect = (task) =>
    `x="${round(mX + task.tileX * k)}" y="${round(mTop + task.tileY * k)}" width="${round(task.width * k)}" height="${round(task.height * k)}"`;
  plan.tasks.forEach((task, id) => {
    if (!touched.has(id))
      map.push(
        `<rect ${blockRect(task)} fill="none" stroke="${RULE}" stroke-width=".5" stroke-opacity=".7"/>`,
      );
  });
  for (const id of touched) {
    map.push(
      `<rect ${blockRect(plan.tasks[id])} fill="url(#region-decode-hatch)" stroke="${ACCENT_STRONG}" stroke-width=".8"/>`,
    );
  }
  for (let r = 0; r < levels; r += 1) {
    const res = plan.resolutions[r];
    map.push(
      `<rect x="${mX}" y="${mTop}" width="${round(res.width * k)}" height="${round(res.height * k)}" fill="none" stroke="${INK_SOFT}" stroke-width="1"/>`,
    );
  }
  map.push(
    `<rect x="${mX}" y="${mTop}" width="${mW}" height="${mH}" fill="none" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  );
  const prev = plan.resolutions[levels - 1];
  const bandLabel = (x, y, label) =>
    t(x, y, label, { font: MONO, size: 10.5, weight: 700, fill: INK_MUTE });
  map.push(bandLabel(mX + prev.width * k + 8, mTop + 16, "HL"));
  map.push(bandLabel(mX + 8, mTop + prev.height * k + 16, "LH"));
  map.push(bandLabel(mX + prev.width * k + 8, mTop + prev.height * k + 16, "HH"));
  /* Each point's coefficient position at the finest level: (x >> 1, y >> 1)
     offset into each subband — the geometry the touched clusters sit on. */
  for (const point of points) {
    const hx = point.x >> 1;
    const hy = point.y >> 1;
    for (const [ox, oy] of [
      [prev.width, 0],
      [0, prev.height],
      [prev.width, prev.height],
    ]) {
      const x = mX + (ox + hx) * k;
      const y = mTop + (oy + hy) * k;
      map.push(
        `<path d="M${round(x - 3)} ${round(y)} h6 M${round(x)} ${round(y - 3)} v6" stroke="${INK}" stroke-width="1.1"/>`,
      );
    }
  }
  map.push(
    t(
      mX + mW,
      mTop + mH + 18,
      "tile buffer: the finest subbands ring the coarser levels, recursively",
      {
        font: MONO,
        size: 10,
        fill: INK_MUTE,
        anchor: "end",
      },
    ),
  );

  /* ── Panel C: the sublinear cost curve, computed by decodeJ2kRegion ── */
  const cTop = 428;
  const barX = 150;
  const barW = 700;
  const bars = [];
  series.forEach((entry, index) => {
    const y = cTop + 44 + index * 26;
    bars.push(
      t(barX - 10, y + 9, `${entry.count} ${entry.count === 1 ? "point" : "points"}`, {
        font: MONO,
        size: 11,
        fill: INK,
        anchor: "end",
      }),
    );
    bars.push(
      `<rect x="${barX}" y="${y}" width="${round((entry.decoded / total) * barW)}" height="13" fill="${ACCENT}" stroke="${ACCENT_STRONG}" stroke-width=".8"/>`,
    );
    bars.push(
      t(barX + (entry.decoded / total) * barW + 8, y + 10.5, `${entry.decoded}`, {
        font: MONO,
        size: 11,
        weight: 700,
        fill: ACCENT_STRONG,
      }),
    );
  });
  const barsBottom = cTop + 44 + series.length * 26;
  bars.push(
    `<path d="M${barX + barW} ${cTop + 38} V${barsBottom}" stroke="${INK_SOFT}" stroke-width="1.2" stroke-dasharray="5 4"/>`,
  );
  bars.push(
    t(barX + barW, cTop + 32, `${total} = every codeblock (full decode)`, {
      font: MONO,
      size: 10,
      fill: INK_SOFT,
      anchor: "end",
    }),
  );
  const pointsFactor = series[series.length - 1].count / series[0].count;
  const blocksFactor = series[series.length - 1].decoded / series[0].decoded;
  bars.push(
    t(
      barX,
      barsBottom + 20,
      `points ×${pointsFactor} -> codeblocks ×${Math.round(blocksFactor)}: nearby points share windows, and every point's coarse-level ancestry converges`,
      {
        font: MONO,
        size: 10.5,
        fill: INK_SOFT,
      },
    ),
  );

  const rows = [
    {
      term: "touched",
      text:
        `filled + hatched: the ${four.decoded} codeblocks whose bytes this 4-point decode ` +
        `entropy-decoded (the set is read off the decode itself and equals its codeblocksDecoded)`,
    },
    {
      term: "untouched",
      text:
        `outline only: the other ${total - four.decoded} codeblocks are skipped after the ` +
        `packet-structure parse; their bytes are never entropy-decoded`,
    },
    {
      term: "crosses",
      text:
        "each requested point's coefficient position in the three finest subbands; the same " +
        "four neighbourhoods recur at every coarser level, which is why cost tracks codeblocks, not points",
    },
  ];
  const ledger = ledgerRows(rows, 980, barsBottom + 44);

  const body = `${panelChip(24, 8, "A")}
  ${t(58, 26, "THE REQUEST", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(364, 25, "image space", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="42" x2="364" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${imagePanel.join("\n  ")}
  ${panelChip(386, 8, "B")}
  ${t(420, 26, "WHAT IT TOUCHES", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(976, 25, `${total} codeblocks · ${levels} decomposition levels`, { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="386" y1="42" x2="976" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${map.join("\n  ")}
  ${panelChip(24, cTop - 34, "C")}
  ${t(58, cTop - 16, "CODEBLOCKS TOUCHED AS POINTS MULTIPLY", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(976, cTop - 17, "same field · same seed per count", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
  <line x1="24" y1="${cTop}" x2="976" y2="${cTop}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${bars.join("\n  ")}
  ${ledger.markup}`;

  return frame({
    id: "region-decode",
    title: "Region-decode cost tracks codeblocks, not points",
    lesson: `decodeJ2kRegion entropy-decodes only the codeblocks the requested points touch: 4 points on the ${samples.toLocaleString("en-CA")}-sample HRDPS continental field decode ${four.decoded} of ${total}.`,
    description: `Three panels. Left, the ${width} × ${height} HRDPS continental field with the bench's 4 scattered sample points marked. Centre, the codestream's tile buffer: all ${total} codeblocks drawn across ${levels} decomposition levels, with the ${four.decoded} codeblocks this 4-point decode actually entropy-decoded filled and hatched, clustering around each point's coefficient position in every subband. Below, the touched count as the same scatter grows: ${series.map((entry) => `${entry.count} point${entry.count === 1 ? "" : "s"} -> ${entry.decoded}`).join(", ")} of ${total} codeblocks; points ×${pointsFactor} costs only ×${Math.round(blocksFactor)} in codeblocks.`,
    caption:
      "Every count is computed at figure-generation time by calling decodeJ2kRegion on the JPEG 2000 codestream embedded in the committed fixture (grib/test/fixtures/hrdps-continental-tmp-2m.grib2), with the point scatter reproducing the committed bench's seed (j2k/test/region.test.ts). The highlighted blocks are the exact set whose bytes that decode read, verified equal to its reported codeblocksDecoded.",
    units: "codeblocks count · points count · samples count · coordinates gridpoints",
    bodyWidth: 980,
    bodyHeight: barsBottom + 44 + ledger.height,
    body,
  });
}

async function composeConvergenceLadder() {
  /* Rung values are schematic (a structural diagram, not a data plot), but
     every printed number obeys the arithmetic it illustrates: leads step 12 h
     for a twice-daily model against a local-noon anchor 7 h behind UTC, and
     each panel's spreadM is genuinely max - min over its sample. */
  const votePill = (x, baseline, vote) => {
    const styles = {
      window: { fill: ACCENT, stroke: ACCENT_STRONG, dash: "", ink: ACCENT_INK },
      quiet: { fill: SURFACE, stroke: RULE_STRONG, dash: "", ink: INK },
      abstained: { fill: SURFACE, stroke: RULE, dash: ' stroke-dasharray="4 3"', ink: INK_MUTE },
    };
    const style = styles[vote];
    return `<rect x="${x}" y="${baseline - 14}" width="86" height="20" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.2"${style.dash}/>
  ${t(x + 43, baseline, vote, { font: MONO, size: 10, weight: 700, fill: style.ink, anchor: "middle" })}`;
  };

  const ladder = (x0, spec) => {
    const parts = [];
    parts.push(panelChip(x0, 8, spec.chip));
    parts.push(t(x0 + 34, 26, spec.heading, { font: DISPLAY, size: 18, weight: 800, ls: 0.36 }));
    parts.push(t(x0 + 446, 25, spec.note, { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" }));
    parts.push(
      `<line x1="${x0}" y1="42" x2="${x0 + 446}" y2="42" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
    );
    parts.push(
      t(x0 + 16, 62, "target local day 2026-08-14 · anchor 12:00 local (leadAnchorLocalHour 12)", {
        font: MONO,
        size: 9.5,
        fill: INK_SOFT,
      }),
    );
    const header = { font: MONO, size: 9, weight: 700, ls: 0.5, fill: INK_MUTE };
    parts.push(t(x0 + 16, 84, "RUN", header));
    parts.push(t(x0 + 104, 84, "LEAD", header));
    parts.push(t(x0 + 186, 84, "VOTE", header));
    parts.push(t(x0 + 430, 84, "MAGNITUDE M", { ...header, anchor: "end" }));

    parts.push(
      `<rect x="${x0 + 8}" y="96" width="430" height="126" fill="${SURFACE_ACCENT}" stroke="${ACCENT_STRONG}" stroke-width="1.4"/>`,
    );
    parts.push(
      t(x0 + 16, 114, "SETTLED SAMPLE · NEWEST minRuns = 3 RUNGS", {
        font: MONO,
        size: 9.5,
        weight: 700,
        ls: 0.4,
        fill: ACCENT_STRONG,
      }),
    );
    const baselines = [140, 172, 204, 246, 278];
    spec.rows.forEach((row, index) => {
      const y = baselines[index];
      parts.push(t(x0 + 16, y, row.run, { font: MONO, size: 11, weight: 700 }));
      parts.push(t(x0 + 104, y, `lead ${row.lead} h`, { font: MONO, size: 10, fill: INK_SOFT }));
      parts.push(votePill(x0 + 186, y, row.vote));
      if (row.tag) parts.push(t(x0 + 282, y, row.tag, { font: MONO, size: 9.5, fill: INK_MUTE }));
      parts.push(
        t(x0 + 430, y, row.magnitude, {
          font: MONO,
          size: 11.5,
          weight: row.magnitude === "—" ? 400 : 700,
          fill: row.magnitude === "—" ? INK_MUTE : INK,
          anchor: "end",
        }),
      );
    });
    parts.push(
      t(x0 + 16, 302, "rungs below the band are read, not sampled; settled sees the newest 3", {
        font: MONO,
        size: 9.5,
        fill: INK_MUTE,
      }),
    );
    parts.push(t(x0 + 16, 330, spec.sampleLine, { font: MONO, size: 10.5, fill: INK_SOFT }));
    parts.push(t(x0 + 16, 352, spec.spreadLine, { font: MONO, size: 11.5, weight: 700 }));
    parts.push(
      t(x0 + 16, 382, spec.verdictLine, {
        font: MONO,
        size: 13,
        weight: 800,
        fill: spec.verdictFill,
      }),
    );
    return parts.join("\n  ");
  };

  const settled = ladder(24, {
    chip: "A",
    heading: "A SETTLED DAY",
    note: "one model · newest run first",
    rows: [
      { run: "08-14 00Z", lead: 19, vote: "window", magnitude: "1480" },
      { run: "08-13 12Z", lead: 31, vote: "window", magnitude: "1370" },
      { run: "08-13 00Z", lead: 43, vote: "window", magnitude: "1520" },
      { run: "08-12 12Z", lead: 55, vote: "window", magnitude: "1750" },
      { run: "08-12 00Z", lead: 67, vote: "abstained", tag: "outOfHorizon", magnitude: "—" },
    ],
    sampleLine: "sample, newest first: 1480 · 1370 · 1520 m",
    spreadLine: "spreadM = max - min = 1520 - 1370 = 150 m",
    verdictLine: "150 <= magnitudeBandM 300 -> settled: true",
    verdictFill: ACCENT_STRONG,
  });

  const unsettled = ladder(510, {
    chip: "B",
    heading: "AN UNSETTLED DAY",
    note: "same site · same thresholds",
    rows: [
      { run: "08-14 00Z", lead: 19, vote: "window", magnitude: "1980" },
      { run: "08-13 12Z", lead: 31, vote: "window", magnitude: "1420" },
      { run: "08-13 00Z", lead: 43, vote: "quiet", tag: "peakLiftDepthM", magnitude: "990" },
      { run: "08-12 12Z", lead: 55, vote: "quiet", tag: "peakLiftDepthM", magnitude: "640" },
      { run: "08-12 00Z", lead: 67, vote: "abstained", tag: "outOfHorizon", magnitude: "—" },
    ],
    sampleLine: "sample, newest first: 1980 · 1420 · 990 m",
    spreadLine: "spreadM = max - min = 1980 - 990 = 990 m",
    verdictLine: "990 > magnitudeBandM 300 -> settled: false",
    verdictFill: INK,
  });

  const rows = [
    {
      term: "rungs",
      text:
        "newest run first: votes and abstention reasons are existenceTrajectory rungs; " +
        "magnitudes are the settled sample's peakLiftAboveLaunchM: a window rung's peak " +
        "lift above launch, a quiet rung's peakLiftDepthM",
    },
    {
      term: "leadHours",
      text:
        "hours from the run's referenceTime to hour leadAnchorLocalHour of the target day " +
        "(default 12, local noon); negative restates a past day, arithmetic like any other",
    },
    {
      term: "settled",
      text:
        "true exactly when the newest minRuns rungs all state a magnitude and max - min <= " +
        "magnitudeBandM; fewer runs, or any null magnitude, reads settled: false with spreadM " +
        "null; not stable and not statable stay readable apart",
    },
    {
      term: "thresholds",
      text:
        "{ minRuns: 3, magnitudeBandM: 300 }: embedded trial defaults, caller-movable via " +
        "CompareRunsOptions.settled, and every finding echoes the values that produced it",
    },
  ];
  const ledger = ledgerRows(rows, 980, 412);

  const body = `${settled}
  <line x1="490" y1="8" x2="490" y2="392" stroke="${RULE}" stroke-width="1"/>
  ${unsettled}
  ${ledger.markup}`;

  return frame({
    id: "convergence-ladder",
    title: "The convergence ladder, settled beside unsettled",
    lesson:
      "compareRuns stacks successive runs of one model against one target local day; settled is arithmetic over the newest minRuns rungs' magnitudes: a statement about runs, not probability and not skill.",
    description:
      "Two five-rung convergence ladders for the same schematic target local day, newest run first, each rung labelled with its run reference time, its leadHours to the day's local-noon anchor (19 to 67 hours), and its vote. Left, a settled day: the newest three rungs vote window with magnitudes 1480, 1370, and 1520 m above launch; spreadM = 1520 - 1370 = 150 m, within magnitudeBandM 300, so settled is true. Right, an unsettled day: window rungs at 1980 and 1420 m and a quiet rung at 990 m of depth give spreadM = 1980 - 990 = 990 m, over the band, so settled is false. In both ladders the settled band encloses only the newest minRuns = 3 rungs; an older rung votes outside the band, and the oldest rung is an abstention with the stated reason outOfHorizon and no magnitude.",
    caption:
      "Rung values are schematic (a structural diagram, not measured runs), but every printed number obeys the arithmetic it illustrates: leads step 12 hours for a twice-daily model against a local-noon anchor seven hours behind UTC, and each spreadM is max - min over its sample. minRuns 3 and magnitudeBandM 300 are the embedded defaults (DEFAULT_SETTLED_THRESHOLDS), trial values calibrated on a thin archive.",
    units:
      "leads hours · magnitudes m above launch (quiet rungs: m of depth) · schematic; no measured data",
    bodyWidth: 980,
    bodyHeight: 412 + ledger.height,
    body,
  });
}

async function composeIngestLoop() {
  const step = (x, y, w, n, title, subs, titleFont = MONO, titleSize = 12.5) => {
    const cx = x + w / 2;
    return `<rect x="${x}" y="${y}" width="${w}" height="68" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${chip(x, y, n)}
  ${t(cx, y + 26, title, { font: titleFont, size: titleSize, weight: 800, anchor: "middle", ...(titleFont === DISPLAY ? { ls: 0.4 } : {}) })}
  ${t(cx, y + 44, subs[0], { size: 10.5, fill: INK_MUTE, anchor: "middle" })}
  ${t(cx, y + 58, subs[1], { size: 10.5, fill: INK_MUTE, anchor: "middle" })}`;
  };
  const flow = (d, dashed = false) =>
    `<path d="${d}" stroke="${INK_SOFT}" stroke-width="1.5" fill="none"${dashed ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#ingest-loop-head)"/>`;

  const body = `${flowMarker("ingest-loop-head")}
  ${step(40, 58, 190, "1", "POLL runs.json", ["loadRuns: one small fetch;", "the poll is the subscription"])}
  ${flow("M230 92 H268")}

  ${step(272, 58, 230, "2", "(referenceTime, generatedAt)", ["the identity pair, compared", "against seen[slug] per model"], MONO, 11)}
  ${flow("M502 92 H540")}
  ${t(521, 38, "pair changed", { font: MONO, size: 9, fill: INK_SOFT, anchor: "middle" })}

  ${step(544, 58, 210, "3", "loadSiteSet", ["the manifest is the commit point;", "misses never poison the set"])}
  ${flow("M754 92 H792")}
  ${t(773, 38, "still mixed after one retry", { font: MONO, size: 9, fill: INK_SOFT, anchor: "middle" })}

  ${step(796, 58, 160, "4", "syncing: true", ["a publish mid-flight;", "runsSeen names the runs"], MONO, 12)}

  ${flow("M387 126 V296")}
  ${t(379, 170, "unchanged pair;", { font: MONO, size: 10, fill: INK_SOFT, anchor: "end" })}
  ${t(379, 184, "nothing new this tick", { font: MONO, size: 10, fill: INK_SOFT, anchor: "end" })}

  ${flow("M649 126 V174")}
  ${t(659, 154, "syncing: false; one run anchors the whole set", { font: MONO, size: 10, fill: INK_SOFT })}

  ${step(544, 178, 210, "5", "ATOMIC SWAP", ["store the set under its new", "referenceTime · advance seen[slug]"], DISPLAY, 15)}
  ${flow("M649 246 V296")}
  ${t(639, 276, "the new run becomes what you serve", { font: MONO, size: 10, fill: INK_SOFT, anchor: "end" })}

  ${flow("M876 126 V296")}
  ${t(868, 262, "ingest nothing; the store keeps", { font: MONO, size: 10, fill: INK_SOFT, anchor: "end" })}
  ${t(868, 276, "serving what it already holds", { font: MONO, size: 10, fill: INK_SOFT, anchor: "end" })}

  ${flow("M135 300 V130", true)}
  ${t(145, 216, "next tick; your cadence,", { font: MONO, size: 10, fill: INK_MUTE })}
  ${t(145, 230, "a small fraction of the fastest", { font: MONO, size: 10, fill: INK_MUTE })}
  ${t(145, 244, "runIntervalHours you serve", { font: MONO, size: 10, fill: INK_MUTE })}

  <rect x="40" y="300" width="916" height="84" fill="${STRIP_BG}" stroke="${ACCENT}" stroke-width="1.8"/>
  ${t(498, 330, "SERVING: THE NEWEST COHERENT PUBLICATION THE STORE HOLDS", { font: DISPLAY, size: 19, weight: 800, ls: 0.4, anchor: "middle" })}
  ${t(498, 351, "the standing state, not a step: the predecessor keeps serving through syncing sets, late runs, and dead ticks", { size: 11, fill: INK_SOFT, anchor: "middle" })}
  ${t(498, 369, 'never a partially ingested run · never delete on a miss: "this is the 06Z run; the 12Z is late"', { font: MONO, size: 10, fill: INK_MUTE, anchor: "middle" })}`;

  return frame({
    id: "ingest-loop",
    title: "The ingest loop returns to serving",
    lesson:
      "Five package-verb steps (poll, compare the identity pair, fetch the coherent set, refuse a syncing one, swap atomically) all return to one standing state: serve the newest coherent publication the store holds.",
    description:
      "A cycle diagram of the ingest loop. Step 1 polls runs.json with loadRuns; step 2 compares each model's (referenceTime, generatedAt) identity pair against the last pair seen; an unchanged pair returns to serving with nothing new this tick. A changed pair leads to step 3, loadSiteSet, where the manifest fetched once is the commit point and per-site misses never poison the set. If the set still mixes runs after one retry, step 4's syncing: true branch ingests nothing (runsSeen names the runs observed) and returns to serving what the store already holds. A coherent set reaches step 5, the atomic swap: store the set under its new referenceTime and advance seen. Beneath the steps, the standing state every path returns to: serving the newest coherent publication the store holds (the predecessor through syncing sets, late runs, and dead ticks), with a dashed edge back to step 1 on the next tick of your own cadence.",
    caption:
      "A later generatedAt for the same referenceTime is a corrected re-publication, and re-ingesting it is exactly as mandatory as a new run. loadSiteSet retries a mid-publish mix once before reporting syncing: true. How many predecessors to keep is retention: consumer policy, never a dataset property.",
    units: "one poll tick; no numeric scale",
    bodyWidth: 980,
    bodyHeight: 392,
    body,
  });
}

async function composeAnalyzeEnvelope(ctx) {
  const { analyzeForecast, ANALYZE_VOCABULARY_VERSION } =
    await ctx.importPackage("briefing/analyze");
  const meta = ctx.scenarioMeta("convective-cycle");
  const profile = await ctx.loadProfile("convective-cycle");
  const envelope = analyzeForecast(profile, { launch: meta.launch });
  if (envelope.extensions !== undefined) {
    throw new Error(
      "[analyze-envelope] the teaching envelope grew extensions; this figure states their absence",
    );
  }

  /* The left card quotes the envelope analyzeForecast computed at
     figure-generation time; the right column is compare.md's validation
     list. The chips pair each validated field with its validation. */
  const cardW = 452;
  const q = (value) => `"${value}"`;
  const groups = [
    {
      label: "IDENTITY · THE MEMBER KEY AND ITS SITE",
      rows: [
        { chip: "1", text: `vocabularyVersion: ${envelope.vocabularyVersion}` },
        { chip: "6", text: `model: ${q(envelope.model)}` },
        { text: `run: { referenceTime: ${q(envelope.run.referenceTime)} }` },
        { chip: "2", text: `site: { id: ${q(envelope.site.id)},` },
        { text: `        launchAltitudeM: ${envelope.site.launchAltitudeM},` },
        { text: `        modelElevationM: ${envelope.site.modelElevationM} }` },
        { chip: "3", text: `timeZone: ${q(envelope.timeZone)} (${envelope.timeZoneSource})` },
      ],
    },
    {
      label: "THE SELF-DESCRIPTION · REQUIRED SINCE V4",
      accent: true,
      rows: [
        {
          chip: "4",
          text: `thresholds: { ${Object.keys(envelope.thresholds).length} kinds, fully resolved }`,
        },
        { chip: "5", text: `deterministic: ${envelope.deterministic}` },
        { chip: "5", text: `coveredDays: [${envelope.coveredDays.map(q).join(", ")}]` },
        { text: "extensions: absent, not empty" },
      ],
    },
    {
      label: "THE STATEMENTS",
      rows: [
        { text: `findings: [ ${envelope.findings.length} findings, each carrying` },
        { text: "            its thresholds and cited evidence ]" },
        {
          text: `stepHours: ${envelope.stepHours} · hours: ${envelope.hours}`,
        },
      ],
    },
  ];

  const card = [];
  card.push(
    t(16, 26, "ONE SERIALIZED ENVELOPE", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 }),
  );
  card.push(
    t(cardW - 16, 25, "computed by analyzeForecast", {
      font: MONO,
      size: 9.5,
      fill: INK_MUTE,
      anchor: "end",
    }),
  );
  card.push(
    `<line x1="0" y1="40" x2="${cardW}" y2="40" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  );
  let cy = 64;
  for (const group of groups) {
    if (group.accent) {
      const boxTop = cy - 16;
      const boxHeight = 22 + group.rows.length * 22;
      card.push(
        `<rect x="8" y="${boxTop}" width="${cardW - 16}" height="${boxHeight}" fill="${SURFACE_ACCENT}" stroke="${ACCENT_STRONG}" stroke-width="1.4"/>`,
      );
    }
    card.push(
      t(16, cy, group.label, {
        font: MONO,
        size: 9.5,
        weight: 700,
        ls: 0.4,
        fill: group.accent ? ACCENT_STRONG : INK_MUTE,
      }),
    );
    cy += 22;
    for (const row of group.rows) {
      if (row.chip) card.push(chip(26, cy - 4, row.chip));
      card.push(t(42, cy, row.text, { font: MONO, size: 11, fill: INK }));
      cy += 22;
    }
    cy += 10;
  }
  const cardHeight = cy;
  card.unshift(
    `<rect width="${cardW}" height="${cardHeight}" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  );

  const validations = [
    {
      n: "1",
      text:
        `vocabularyVersion: strict equality with this package's ANALYZE_VOCABULARY_VERSION ` +
        `(${ANALYZE_VOCABULARY_VERSION}); skew throws with the remedy named: re-analyze, or compare ` +
        "with the package that produced it",
    },
    {
      n: "2",
      text:
        "site.id and site.launchAltitudeM: one comparison, one site, one launch; a mismatch " +
        "throws, null-vs-number included",
    },
    { n: "3", text: "timeZone: day keys pair only in one zone" },
    {
      n: "4",
      text:
        "thresholds: deep equality, naming the first differing path " +
        "(thermalWindow.wstarMinMps: 0.9 vs 0.8)",
    },
    {
      n: "5",
      text:
        "thresholds / deterministic / coveredDays present: the runtime door for parsed JSON an " +
        "old-enough serialization fails; deterministic is the precomputed p50 fact, never re-derived",
    },
    {
      n: "6",
      text:
        "(model, run.referenceTime): member identity since vocabulary 2; the same run twice " +
        "is a programming error and throws",
    },
  ];
  const rightX = 496;
  const rightW = 484;
  const right = [];
  right.push(
    t(rightX, 26, "COMPAREANALYSES VALIDATES, NEVER RECONSTRUCTS", {
      font: DISPLAY,
      size: 18,
      weight: 800,
      ls: 0.36,
    }),
  );
  right.push(
    `<line x1="${rightX}" y1="40" x2="${rightX + rightW}" y2="40" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
  );
  const list = legendRows(validations, rightW, 0);
  right.push(`<g transform="translate(${rightX} 62)">${list.markup}</g>`);

  const bodyHeight = Math.max(cardHeight, 62 + list.height) + 34;
  const body = `${card.join("\n  ")}
  ${right.join("\n  ")}
  ${t(0, bodyHeight - 2, "compareAnalyses options deliberately lack timeZone, launch, and thresholds: they come from the members and are validated, never supplied", { font: MONO, size: 10.5, fill: INK_SOFT })}`;

  return frame({
    id: "analyze-envelope",
    title: "The envelope re-enters compare without the profile",
    lesson:
      "Everything a downstream comparison validates or states about a member rides the serialized ForecastAnalysis itself: analyze once at the edge, cache the envelope as JSON, and compare later without re-opening any profile.",
    description: `The envelope analyzeForecast computed for the committed convective-cycle teaching profile, quoted field by field: vocabularyVersion ${envelope.vocabularyVersion}, member identity (model and run referenceTime), the site block with the launch the analysis ran against, the timezone and its source, and the required self-description: the fully resolved thresholds for ${Object.keys(envelope.thresholds).length} kinds, the precomputed deterministic flag, the coveredDays the hours actually touch, and extensions absent rather than empty. Beside it, the six named validations compareAnalyses runs against those same fields: vocabulary-version skew, site and launch mismatch, timezone mismatch, thresholds deep-inequality, missing self-description, and duplicate member identity.`,
    caption:
      "The left card is not hand-written: every value is read from the envelope analyzeForecast returns for the committed teaching profile at figure-generation time, and the figure refuses to build if that envelope grows extensions. The right column is the validation list the compare guide documents; each failure is a distinct, named error.",
    units: "no numeric scale · a document anatomy",
    bodyWidth: 980,
    bodyHeight,
    body,
  });
}

async function composeReliefPercentiles(ctx) {
  /* Both panels read the committed site-context sample document at
     figure-generation time (the same bytes the site serves at
     /data-sample/site-context.json), so the figure drifts with the data. */
  const context = JSON.parse(
    readFileSync(join(ctx.root, "site/public/data-sample/site-context.json"), "utf8"),
  );
  const panels = [
    {
      chip: "A",
      slug: "test-hill",
      heading: "A RISE, MID-SLOPE IN BIGGER TERRAIN",
    },
    {
      chip: "B",
      slug: "test-valley",
      heading: "A VALLEY FLOOR AS THE RADIUS GROWS",
    },
  ].map((spec) => {
    const site = context.sites[spec.slug];
    if (!site) throw new Error(`[relief-percentiles] ${spec.slug} left the sample document`);
    return { ...spec, site };
  });

  const panelW = 452;
  const plotTop = 96;
  const plotHeight = 240;
  const barW = 72;
  const barXs = [64, 200, 336];

  const panelMarkup = (spec, x0) => {
    const { terrain } = spec.site;
    const discs = terrain.relief;
    const minM = Math.min(...discs.map((disc) => disc.minM));
    const maxM = Math.max(...discs.map((disc) => disc.maxM));
    const pad = (maxM - minM) * 0.08;
    const yFor = (m) =>
      plotTop + plotHeight - ((m - (minM - pad)) / (maxM - minM + pad * 2)) * plotHeight;

    const parts = [];
    parts.push(panelChip(x0, 8, spec.chip));
    parts.push(t(x0 + 34, 26, spec.heading, { font: DISPLAY, size: 17, weight: 800, ls: 0.36 }));
    parts.push(t(x0 + 16, 52, spec.slug, { font: MONO, size: 11, weight: 700, fill: INK_SOFT }));
    parts.push(
      t(
        x0 + panelW - 16,
        52,
        `launch pick ${spec.site.elevation.elevationM} m · ${spec.site.elevation.source}`,
        { font: MONO, size: 9.5, weight: 700, fill: ACCENT_STRONG, anchor: "end" },
      ),
    );
    parts.push(
      `<line x1="${x0}" y1="64" x2="${x0 + panelW}" y2="64" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
    );

    discs.forEach((disc, index) => {
      const bx = x0 + barXs[index];
      const yMax = yFor(disc.maxM);
      const yMin = yFor(disc.minM);
      parts.push(
        `<rect x="${bx}" y="${round(yMax)}" width="${barW}" height="${round(yMin - yMax)}" fill="${SURFACE_SUNKEN}" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
      );
      parts.push(
        t(bx + barW / 2, yMax - 8, `${localeRound(disc.maxM)} m`, {
          font: MONO,
          size: 9.5,
          fill: INK_SOFT,
          anchor: "middle",
        }),
      );
      parts.push(
        t(bx + barW / 2, yMin + 14, `${localeRound(disc.minM)} m`, {
          font: MONO,
          size: 9.5,
          fill: INK_SOFT,
          anchor: "middle",
        }),
      );
      parts.push(
        t(bx + barW / 2, plotTop + plotHeight + 34, `${disc.radiusKm} km`, {
          font: MONO,
          size: 11,
          weight: 700,
          anchor: "middle",
        }),
      );
      const launchY = yFor(spec.site.elevation.elevationM);
      parts.push(
        `<rect x="${bx + 6}" y="${round(launchY - 11)}" width="${barW - 12}" height="17" fill="${ACCENT}" stroke="${HALO}" stroke-width="1.2"/>`,
      );
      parts.push(
        t(bx + barW / 2, launchY + 2, `p${disc.percentile}`, {
          font: MONO,
          size: 10.5,
          weight: 800,
          fill: ACCENT_INK,
          anchor: "middle",
        }),
      );
    });

    const launchY = yFor(spec.site.elevation.elevationM);
    parts.push(
      `<line x1="${x0 + 28}" y1="${round(launchY)}" x2="${x0 + panelW - 28}" y2="${round(launchY)}" stroke="${ACCENT_STRONG}" stroke-width="1.6" stroke-dasharray="6 4"/>`,
    );
    parts.push(
      `<text x="${x0 + 24}" y="${round(launchY + 3)}" text-anchor="end" fill="${ACCENT_STRONG}" font-family="${MONO}" font-size="9" font-weight="700" stroke="${HALO}" stroke-width="3" paint-order="stroke">${escapeXml("launch")}</text>`,
    );
    parts.push(
      t(x0 + 16, plotTop + plotHeight + 34, "disc radius", { font: MONO, size: 9, fill: INK_MUTE }),
    );
    return parts.join("\n  ");
  };

  const rows = [
    {
      term: "the bars",
      text:
        "each relief disc's minM-to-maxM terrain span, from the committed document: one " +
        "consistent elevation model (glo30) across every site, so the numbers compare",
    },
    {
      term: "percentile",
      text:
        "the launch elevation's rank among the disc's terrain, a topological reading rather than a " +
        "height fraction: 100 is the local summit, 50 mid-slope; aspectDeg goes low-confidence " +
        "near 100",
    },
    {
      term: "the line",
      text:
        "THE launch elevation: the elevation block's measured pick (lidarbc here), the number " +
        "consumers render the launch line with and read launch-relative analysis against",
    },
    {
      term: "read together",
      text:
        "one radius is not a verdict: high at 1 km and low at 10 km is a foothill in front of " +
        "bigger terrain; falling with radius, as on the valley floor, is terrain growing above " +
        "the launch",
    },
  ];
  const ledger = ledgerRows(rows, 980, plotTop + plotHeight + 58);

  const body = `${panelMarkup(panels[0], 0)}
  <line x1="490" y1="8" x2="490" y2="${plotTop + plotHeight + 44}" stroke="${RULE}" stroke-width="1"/>
  ${panelMarkup(panels[1], 528)}
  ${ledger.markup}`;

  return frame({
    id: "relief-percentiles",
    title: "Relief discs read together",
    lesson:
      "Each relief disc states its terrain span and the launch's percentile rank within it; the radii only mean something side by side: the same launch can be a local high point at 1 km and sit low in its 10 km terrain.",
    description:
      "Two panels of three relief discs each, read from the committed site-context sample. Left, test-hill: the launch pick sits at the 73rd percentile of the 1 km disc, the 60th at 3 km, and the 52nd at 10 km, a local rise settling toward mid-slope as bigger terrain enters the disc. Right, test-valley: 60th at 1 km, 43rd at 3 km, and 12th at 10 km, a valley floor once the 10 km disc reaches the surrounding mountains. In every panel the dashed line is the elevation block's measured launch pick crossing all three min-to-max terrain bars.",
    caption:
      "Every number is read from the committed sample document (site/public/data-sample/site-context.json) at figure-generation time: bar ends are each disc's minM and maxM, chips are its percentile field, and the dashed line is the elevation pick. The percentile is a rank among the disc's terrain, not a linear position between the bar ends; the chips ride the launch line only because that is the elevation whose rank they state.",
    units: "elevations m MSL · disc radii km · percentile rank 0-100",
    bodyWidth: 980,
    bodyHeight: plotTop + plotHeight + 58 + ledger.height,
    body,
  });
}

async function composeObservationQualityGate() {
  /* Encodings, ranges, and DQF vocabularies are the observation guide's
     verified product facts (2026-08-10), restated here as geometry: the
     same uint16 code 65535 is fill in both products, but only DSR's
     valid_range contains it. */
  const panelW = 452;
  const lineY = 96;
  const lineW = 388;
  const lineX = 32;

  const panel = (x0, spec) => {
    const parts = [];
    parts.push(panelChip(x0, 8, spec.chip));
    parts.push(t(x0 + 34, 26, spec.heading, { font: DISPLAY, size: 17, weight: 800, ls: 0.36 }));
    parts.push(t(x0 + 16, 50, spec.product, { font: MONO, size: 9.5, fill: INK_MUTE }));
    parts.push(
      `<line x1="${x0}" y1="62" x2="${x0 + panelW}" y2="62" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
    );

    /* the uint16 number line */
    const nl = x0 + lineX;
    parts.push(
      t(nl, lineY - 18, "THE UINT16 CODES", {
        font: MONO,
        size: 9,
        weight: 700,
        ls: 0.5,
        fill: INK_MUTE,
      }),
    );
    parts.push(
      `<line x1="${nl}" y1="${lineY}" x2="${nl + lineW}" y2="${lineY}" stroke="${INK_SOFT}" stroke-width="1.5"/>`,
    );
    parts.push(t(nl, lineY + 18, "0", { font: MONO, size: 9.5, fill: INK_SOFT }));
    /* valid_range bracket */
    const bracketEnd = nl + lineW * spec.validFraction;
    parts.push(
      `<path d="M${nl} ${lineY - 8} V${lineY - 2} M${nl} ${lineY - 5} H${round(bracketEnd)} M${round(bracketEnd)} ${lineY - 8} V${lineY - 2}" stroke="${ACCENT_STRONG}" stroke-width="1.6" fill="none"/>`,
    );
    parts.push(
      t(nl + (lineW * spec.validFraction) / 2, lineY - 12, `valid_range ${spec.validRange}`, {
        font: MONO,
        size: 9.5,
        weight: 700,
        fill: ACCENT_STRONG,
        anchor: "middle",
      }),
    );
    /* the fill code */
    const fillX = nl + lineW * 0.97;
    parts.push(
      `<circle cx="${round(fillX)}" cy="${lineY}" r="5" fill="${CODE_BG}" stroke="${HALO}" stroke-width="1.5"/>`,
    );
    parts.push(
      t(fillX, lineY + 20, "_FillValue 65535", {
        font: MONO,
        size: 9.5,
        weight: 700,
        anchor: "end",
      }),
    );
    parts.push(
      t(fillX, lineY + 34, spec.fillVerdict, {
        font: MONO,
        size: 9.5,
        weight: 800,
        fill: spec.fillInside ? ACCENT_STRONG : INK_SOFT,
        anchor: "end",
      }),
    );
    parts.push(t(nl, lineY + 34, spec.physical, { font: MONO, size: 9, fill: INK_MUTE }));

    /* DQF states */
    let py = lineY + 66;
    parts.push(
      t(x0 + 16, py, "DQF STATES", { font: MONO, size: 9, weight: 700, ls: 0.5, fill: INK_MUTE }),
    );
    py += 20;
    let px = x0 + 16;
    for (const state of spec.dqf) {
      const w = 14 + state.label.length * 6.8;
      const passed = state.published;
      parts.push(
        `<rect x="${round(px)}" y="${py - 14}" width="${round(w)}" height="20" fill="${passed ? ACCENT : SURFACE}" stroke="${passed ? ACCENT_STRONG : RULE_STRONG}" stroke-width="1.2"${state.dashed ? ' stroke-dasharray="4 3"' : ""}/>`,
      );
      parts.push(
        t(px + w / 2, py, state.label, {
          font: MONO,
          size: 9.5,
          weight: 700,
          fill: passed ? ACCENT_INK : INK_SOFT,
          anchor: "middle",
        }),
      );
      px += w + 8;
    }
    parts.push(
      t(x0 + panelW - 16, py, spec.gateNote, {
        font: MONO,
        size: 9.5,
        weight: 700,
        fill: ACCENT_STRONG,
        anchor: "end",
      }),
    );

    /* the night pixel */
    py += 40;
    parts.push(
      t(x0 + 16, py, "A NIGHT PIXEL ARRIVES AS", {
        font: MONO,
        size: 9,
        weight: 700,
        ls: 0.5,
        fill: INK_MUTE,
      }),
    );
    py += 20;
    parts.push(
      `<rect x="${x0 + 16}" y="${py - 14}" width="${panelW - 32}" height="40" fill="${spec.trap ? SURFACE_ACCENT : SURFACE}" stroke="${spec.trap ? ACCENT_STRONG : RULE_STRONG}" stroke-width="1.4"/>`,
    );
    parts.push(t(x0 + 26, py + 2, spec.night, { font: MONO, size: 10.5, weight: 700 }));
    parts.push(
      t(x0 + 26, py + 18, spec.nightRead, {
        font: MONO,
        size: 9.5,
        fill: spec.trap ? ACCENT_STRONG : INK_MUTE,
      }),
    );
    return parts.join("\n  ");
  };

  const dsr = panel(0, {
    chip: "A",
    heading: "DSR · DOWNWARD SHORTWAVE",
    product: "ABI-L2-DSRF · W/m² · scale 0.02289028",
    validFraction: 1,
    validRange: "spans 0–65535",
    fillInside: true,
    fillVerdict: "INSIDE valid_range",
    physical: "0–1500 W/m²",
    dqf: [
      { label: "0 good", published: true },
      { label: "1 degraded/invalid", published: false },
      { label: "255 space", published: false, dashed: true },
    ],
    gateNote: "published = 0",
    night: "fill · DQF 0",
    nightRead: "the trap: DQF 0 does not imply a retrieval",
    trap: true,
  });

  const aod = panel(528, {
    chip: "B",
    heading: "AOD · AEROSOL OPTICAL DEPTH",
    product: "ABI-L2-AODF · at 550 nm · scale 7.706e-5, offset -0.05",
    validFraction: 0.93,
    validRange: "[0, 65530]",
    fillInside: false,
    fillVerdict: "OUTSIDE valid_range",
    physical: "-0.05 to +5.0",
    dqf: [
      { label: "0 high", published: true },
      { label: "1 medium", published: true },
      { label: "2 low", published: false },
      { label: "3 no retrieval", published: false, dashed: true },
    ],
    gateNote: "published <= 1",
    night: "fill · DQF 3",
    nightRead: "the explicit no-retrieval flag DSR's night-fill-with-DQF-0 lacks",
    trap: false,
  });

  const bandY = 288;
  const body = `${dsr}
  <line x1="490" y1="8" x2="490" y2="${bandY - 12}" stroke="${RULE}" stroke-width="1"/>
  ${aod}
  <rect x="0" y="${bandY}" width="980" height="76" fill="${STRIP_BG}" stroke="${ACCENT}" stroke-width="1.8"/>
  ${t(490, bandY + 28, "ONE GATE, BOTH PRODUCTS: UNMASKED AND QUALITY", { font: DISPLAY, size: 19, weight: 800, ls: 0.4, anchor: "middle" })}
  ${t(490, bandY + 48, "the builder applies the shared gate even where AOD's fill separates cleanly: one code path can only reject more", { size: 11, fill: INK_SOFT, anchor: "middle" })}
  ${t(490, bandY + 64, "anything that fails publishes as absence: never zero, never a guess", { font: MONO, size: 10, fill: INK_MUTE, anchor: "middle" })}`;

  return frame({
    id: "observation-quality-gate",
    title: "Two products, one quality gate",
    lesson:
      "DSR and AOD ride the same grid and the same fill code, but their fill and DQF semantics disagree: DSR's fill hides inside valid_range and its binary DQF flags night as good, while AOD's fill separates cleanly under a graded DQF. The builder trusts neither shortcut and gates both on unmasked AND quality.",
    description:
      "Two panels comparing the GOES-18 DSR and AOD product semantics. Panel A, DSR: a uint16 number line whose valid_range spans all codes, so the fill value 65535 sits inside it and range checks cannot separate fill from data; DQF has two working states, 0 good and 1 degraded/invalid, plus 255 for space, and only 0 publishes; a night pixel arrives as fill with DQF 0, the trap this panel highlights: DQF 0 does not imply a retrieval. Panel B, AOD: valid_range [0, 65530] excludes the same fill code, so range masking alone separates fill from data; DQF is graded 0 high, 1 medium, 2 low, 3 no retrieval, and values through medium publish; a night pixel arrives as fill with the explicit DQF 3. Beneath both, the shared rule: the builder applies the same unmasked-and-quality gate to both products, and anything that fails publishes as absence.",
    caption:
      "Encodings, ranges, and DQF vocabularies are the product facts verified live from the granules on 2026-08-10 and recorded above; the number lines are schematic (codes are not drawn to scale). The gate is goes.ts's one code path for both datasets.",
    units: "uint16 codes, schematic scale · DSR W/m² · AOD dimensionless at 550 nm",
    bodyWidth: 980,
    bodyHeight: 380,
    body,
  });
}

async function composeFreshnessClocks() {
  /* The instants are schematic, but every printed number obeys the
     arithmetic it illustrates: 15 s on the wire pair, 30 s on the client
     pair, and a client wall clock deliberately four minutes fast that the
     two-clock form cancels out. */
  const laneX = 210;
  const laneW = 730;
  const t0 = Date.parse("2026-08-14T12:00:45Z");
  const xFor = (iso) => laneX + ((Date.parse(iso) - t0) / 60000) * (laneW / 1.05);

  const lanes = [
    { y: 34, label: "STATION", sub: "stamps the reading" },
    { y: 104, label: "SERVER", sub: "stamps the response" },
    { y: 174, label: "CLIENT", sub: "wall clock 4 min fast" },
  ];
  const events = [
    { lane: 0, at: "2026-08-14T12:00:45Z", label: "observedAt", wall: "12:00:45Z" },
    { lane: 1, at: "2026-08-14T12:01:00Z", label: "servedAt", wall: "12:01:00Z" },
    { lane: 2, at: "2026-08-14T12:01:07Z", label: "receivedAtMs", wall: "reads 12:05:07" },
    { lane: 2, at: "2026-08-14T12:01:37Z", label: "now", wall: "reads 12:05:37" },
  ];

  const parts = [];
  for (const lane of lanes) {
    parts.push(t(0, lane.y + 4, lane.label, { font: DISPLAY, size: 16, weight: 800, ls: 0.4 }));
    parts.push(t(0, lane.y + 20, lane.sub, { font: MONO, size: 9, fill: INK_MUTE }));
    parts.push(
      `<line x1="${laneX}" y1="${lane.y}" x2="${laneX + laneW}" y2="${lane.y}" stroke="${RULE_STRONG}" stroke-width="1.2"/>`,
    );
  }
  for (const event of events) {
    const x = round(xFor(event.at));
    const y = lanes[event.lane].y;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="6" fill="${ACCENT}" stroke="${HALO}" stroke-width="1.5"/>`,
    );
    parts.push(
      t(x, y - 12, event.label, { font: MONO, size: 10.5, weight: 700, anchor: "middle" }),
    );
    parts.push(
      t(x, y + 22, event.wall, {
        font: MONO,
        size: 9.5,
        fill: event.lane === 2 ? ACCENT_STRONG : INK_SOFT,
        anchor: "middle",
      }),
    );
  }

  /* the two age segments, each inside one clock domain */
  const seg = (fromIso, toIso, y, label) => {
    const x1 = round(xFor(fromIso));
    const x2 = round(xFor(toIso));
    return `<path d="M${x1} ${y - 8} V${y} H${x2} V${y - 8}" fill="none" stroke="${ACCENT_STRONG}" stroke-width="1.6"/>
  ${t((x1 + x2) / 2, y + 16, label, { font: MONO, size: 10.5, weight: 700, fill: ACCENT_STRONG, anchor: "middle" })}`;
  };
  parts.push(
    `<line x1="${round(xFor("2026-08-14T12:00:45Z"))}" y1="34" x2="${round(xFor("2026-08-14T12:00:45Z"))}" y2="228" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 4"/>`,
  );
  parts.push(
    `<line x1="${round(xFor("2026-08-14T12:01:00Z"))}" y1="104" x2="${round(xFor("2026-08-14T12:01:00Z"))}" y2="228" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 4"/>`,
  );
  parts.push(
    seg(
      "2026-08-14T12:00:45Z",
      "2026-08-14T12:01:00Z",
      236,
      "servedAt - observedAt = 15 s · both stamps ride the wire",
    ),
  );
  parts.push(
    seg(
      "2026-08-14T12:01:07Z",
      "2026-08-14T12:01:37Z",
      274,
      "now - receivedAtMs = 30 s · both read on the client",
    ),
  );

  const verdictY = 312;
  parts.push(
    `<rect x="0" y="${verdictY}" width="980" height="88" fill="${STRIP_BG}" stroke="${ACCENT}" stroke-width="1.8"/>`,
  );
  parts.push(
    t(490, verdictY + 30, "AGE = (SERVEDAT - OBSERVEDAT) + (NOW - RECEIVEDATMS) = 45 S", {
      font: DISPLAY,
      size: 19,
      weight: 800,
      ls: 0.4,
      anchor: "middle",
    }),
  );
  parts.push(
    t(
      490,
      verdictY + 52,
      "the naive now - observedAt on this client's wall clock reads 4 min 52 s, a live station misread as stale",
      {
        size: 11,
        fill: INK_SOFT,
        anchor: "middle",
      },
    ),
  );
  parts.push(
    t(
      490,
      verdictY + 72,
      "each difference stays inside one clock domain, so the client's 4-minute error never enters the sum",
      {
        font: MONO,
        size: 10,
        fill: INK_MUTE,
        anchor: "middle",
      },
    ),
  );

  const rows = [
    {
      term: "the grade",
      text:
        'freshness() grades the age into "live" | "aging" | "stale"; between polls every binding ' +
        "re-judges the same reading every 30 s, so a dead feed ages visibly",
    },
    {
      term: "the cutoffs",
      text:
        "stationFreshnessThresholds() scales them to the station's own cadence: ten minutes of " +
        "silence is routine for a five-minute logger and a dead feed for a three-second one",
    },
  ];
  const ledger = ledgerRows(rows, 980, verdictY + 108);

  return frame({
    id: "freshness-clocks",
    title: "Freshness across three clocks",
    lesson:
      "Freshness is judged on the client, but against the server's clock: the wire carries observedAt and servedAt, the client records receivedAtMs, and each subtraction stays inside one clock domain, so a wrong client clock cannot declare a live station stale, or a dead one live.",
    description:
      "Three timeline lanes (station, server, client) with the four instants the freshness model reads. The station stamps observedAt 12:00:45Z; the server stamps the response servedAt 12:01:00Z; the client records receivedAtMs and later reads now, and its wall clock runs four minutes fast, printing 12:05:07 and 12:05:37. Two braces mark the age's two terms: servedAt minus observedAt is 15 seconds, measured entirely from wire values, and now minus receivedAtMs is 30 seconds, measured entirely on the client. The verdict band sums them: age 45 seconds, while the naive now minus observedAt on the fast client wall clock would read 4 minutes 52 seconds and misread a live station as stale.",
    caption:
      "The instants are schematic, but every printed number obeys the arithmetic it illustrates, including the deliberate four-minute client clock error the two-clock form cancels. freshness() and stationFreshnessThresholds() are exported from @azohra/meteo.station; the re-judge cadence is FRESHNESS_REEVALUATE_MS.",
    units: "wall-clock instants UTC · age seconds · client offset schematic",
    bodyWidth: 980,
    bodyHeight: verdictY + 108 + ledger.height,
    body: `${parts.join("\n  ")}
  ${ledger.markup}`,
  });
}

export const PAGE_FIGURE_TARGETS = [
  {
    id: "docs-platform-boundary",
    file: "site/src/content/docs/docs/figures/platform-boundary.svg",
    compose: composePlatformBoundary,
  },
  {
    id: "docs-contract-anatomy",
    file: "briefing/docs/figures/contract-anatomy.svg",
    compose: composeContractAnatomy,
  },
  { id: "docs-torn-read", file: "briefing/docs/figures/torn-read.svg", compose: composeTornRead },
  {
    id: "docs-derive-sink-rate",
    file: "briefing/docs/figures/derive-sink-rate.svg",
    compose: composeDeriveSinkRate,
  },
  {
    id: "docs-analyze-findings",
    file: "briefing/docs/figures/analyze-findings.svg",
    compose: composeAnalyzeFindings,
  },
  {
    id: "docs-compare-agreement",
    file: "briefing/docs/figures/compare-agreement.svg",
    compose: composeCompareAgreement,
  },
  {
    id: "docs-first-meteogram",
    file: "briefing/docs/figures/first-meteogram.svg",
    compose: composeFirstMeteogram,
  },
  {
    id: "docs-scene-anatomy",
    file: "briefing/docs/figures/scene-anatomy.svg",
    compose: composeSceneAnatomy,
  },
  {
    id: "docs-inspector-selection",
    file: "briefing/docs/figures/inspector-selection.svg",
    compose: composeInspectorSelection,
  },
  {
    id: "docs-pointer-states",
    file: "briefing/docs/figures/pointer-states.svg",
    compose: composePointerStates,
  },
  {
    id: "docs-token-contrast",
    file: "briefing/docs/figures/token-contrast.svg",
    compose: composeTokenContrast,
  },
  {
    id: "docs-token-reference",
    file: "briefing/docs/figures/token-reference.svg",
    compose: composeTokenReference,
  },
  {
    id: "docs-analyze-envelope",
    file: "briefing/docs/figures/analyze-envelope.svg",
    compose: composeAnalyzeEnvelope,
  },
  {
    id: "docs-relief-percentiles",
    file: "briefing/docs/figures/relief-percentiles.svg",
    compose: composeReliefPercentiles,
  },
  {
    id: "docs-observation-quality-gate",
    file: "briefing/docs/figures/observation-quality-gate.svg",
    compose: composeObservationQualityGate,
  },
  {
    id: "docs-freshness-clocks",
    file: "station/docs/figures/freshness-clocks.svg",
    compose: composeFreshnessClocks,
  },
  {
    id: "docs-convergence-ladder",
    file: "briefing/docs/figures/convergence-ladder.svg",
    compose: composeConvergenceLadder,
  },
  {
    id: "docs-ingest-loop",
    file: "briefing/docs/figures/ingest-loop.svg",
    compose: composeIngestLoop,
  },
  {
    id: "docs-publication-flow",
    file: "forecast/docs/figures/publication-flow.svg",
    compose: composePublicationFlow,
  },
  {
    id: "docs-two-transports",
    file: "forecast/docs/figures/two-transports.svg",
    compose: composeTwoTransports,
  },
  {
    id: "docs-rotated-grid",
    file: "grib/docs/figures/rotated-grid.svg",
    compose: composeRotatedGrid,
  },
  {
    id: "docs-region-decode",
    file: "j2k/docs/figures/region-decode.svg",
    compose: composeRegionDecode,
  },
];
