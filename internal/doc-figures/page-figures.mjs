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
  ${t(56, 130, "cache entry expired first — the new run is visible", { font: MONO, size: 10.5, fill: INK_MUTE })}

  <rect x="510" y="60" width="446" height="92" fill="${STRIP_BG}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(526, 82, "data/<model>/sites/<site>.json", { font: MONO, size: 12, weight: 700 })}
  ${runLabel(526, 104, "run.referenceTime", "00Z", INK)}
  ${t(526, 130, "cache entry still valid — the old run is still served", { font: MONO, size: 10.5, fill: INK_MUTE })}

  ${t(490, 178, "06Z against 00Z — a torn pair. Rendering it as one forecast lies about both runs.", { size: 13, weight: 700, fill: ACCENT_STRONG, anchor: "middle" })}

  ${panelChip(24, 204, "2")}
  ${t(58, 222, "THE SKEW DANCE", { font: DISPLAY, size: 18, weight: 800, ls: 0.36 })}
  ${t(956, 221, "loadForecast — fetch, compare, retry once", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
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
  ${t(56, 458, "a consistent pair — render it", { size: 10.5, fill: INK_MUTE })}

  <rect x="346" y="418" width="286" height="66" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(362, 440, "{ manifest, profile, stale: true }", { font: MONO, size: 11.5, weight: 700 })}
  ${t(362, 458, "freshest complete pair, still torn —", { size: 10.5, fill: INK_MUTE })}
  ${t(362, 472, "note it or fall back; never mix the two", { size: 10.5, fill: INK_MUTE })}

  <rect x="652" y="418" width="304" height="66" fill="${SURFACE}" stroke="${RULE_STRONG}" stroke-width="1.2"/>
  ${t(668, 440, '{ miss: "absent" | "invalid", url }', { font: MONO, size: 11.5, weight: 700 })}
  ${t(668, 458, "absent: routine 404 · invalid: contract break —", { size: 10.5, fill: INK_MUTE })}
  ${t(668, 472, "log it loudly; other HTTP errors throw", { size: 10.5, fill: INK_MUTE })}`;

  return frame({
    id: "torn-read",
    title: "Two cache entries, two runs, one page",
    lesson:
      "Independently cached manifest and profile files can describe different runs; loadForecast detects the torn pair and retries it once.",
    description:
      "A sequence diagram of the transport's reference-time skew dance. A publish refreshes the manifest cache entry before the profile cache entry, so a consumer fetching both receives a manifest from the 06Z run and a profile from the 00Z run. loadForecast compares the pair's reference times with runsConsistent, waits 1.5 seconds, refetches, and returns either a consistent pair, the freshest complete pair marked stale, or a discriminated DocumentMiss.",
    caption:
      "The retry delay defaults to 1500 ms and is injectable. The transport keeps no cache and writes no storage — the stale flag is a report, and the policy it triggers belongs to the caller.",
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
  ${label(440, 248, "click / tap — a touch pointer pins without previewing")}

  ${flow("M750 110 C750 44 130 44 130 106")}
  ${label(440, 58, "click the pinned target again · Escape")}

  ${flow("M840 132 C866 132 866 164 840 164")}
  ${t(862, 152, "re-pin", { size: 11, weight: 600, fill: INK_SOFT })}

  <rect x="620" y="272" width="260" height="38" rx="8" fill="${SURFACE_SUNKEN}" stroke="${RULE}"/>
  ${flow("M750 190 V268", true)}
  ${t(750, 288, "model / day swap", { size: 11.5, weight: 700, anchor: "middle" })}
  ${t(750, 302, "reset, or carry by validAt — consumer decides", { size: 10.5, fill: INK_MUTE, anchor: "middle" })}`;

  return frame({
    id: "pointer-states",
    title: "Preview, pin, and the touch policy",
    lesson:
      "The state machine is small and consumer-owned; the package supplies the pure queries its transitions call.",
    description:
      "A three-state diagram: Resting, Previewing, and Pinned. Pointer movement with a non-touch pointer previews; leaving the chart clears the preview; a click or tap pins from any state; clicking the pinned target again, or Escape, unpins; a model or day swap exits the machine entirely, where the consumer chooses reset or carry.",
    caption:
      "Touch pointers skip the Previewing state — a finger cannot hover, so a tap pins directly. The swap edge is the carry-or-reset decision: key the stored selection by validAt and re-resolve it with hourIndexForValidAt, or reset, as the measured first consumer does.",
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
  ${t(54, 78, ".idx SIDECAR — PLAIN TEXT, FREE", { font: MONO, size: 11, weight: 700, ls: 0.55 })}
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
  ${t(40, 218, `beyond byte ${bytes(maxOffset)} — over ${fileFloorMb} MB`, { font: MONO, size: 10.5, fill: INK_MUTE })}

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
  ${t(956, 269, "ECCC · HRDPS, RDPS, GDPS, REPS, GEPS — Datamart has no index", { font: MONO, size: 11, fill: INK_MUTE, anchor: "end" })}
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

  ${t(490, 464, "repeat, file after file, through the run — memory never holds more than a handful of files", { font: MONO, size: 11.5, weight: 600, fill: INK_SOFT, anchor: "middle" })}

  <line x1="490" y1="478" x2="490" y2="522" stroke="${RULE}" stroke-width="1"/>
  ${t(60, 506, "4–8 GiB", { font: DISPLAY, size: 28, weight: 800, ls: 0.28 })}
  ${t(200, 496, "moved per deterministic run;", { size: 11, fill: INK_MUTE })}
  ${t(200, 511, "~9 GiB REPS · ~14 GiB GEPS", { size: 11, fill: INK_MUTE })}
  ${t(530, 506, "kilobytes kept", { font: DISPLAY, size: 28, weight: 800, ls: 0.28 })}
  ${t(756, 496, "per site and run — the profile JSON", { size: 11, fill: INK_MUTE })}
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
      role: "Sample provenance: identity, coordinates, the model's own terrain (modelElevationM), and the optional timezone echo. No launch elevation — the launch is supplied at render time, not stored in the document.",
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
      role: `One of ${profile.hours.length} chronological UTC hours — the peak-W* hour here. Optional capability fields are absent, never zero.`,
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
    caption: `Every fragment is stringified from the parsed committed profile at figure-generation time — these are the document's actual published values. The excerpted hour is hours[${hourIndex}] of ${profile.hours.length}; each hour repeats the surface/levels/derived shape.`,
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
    `published series (1.0 m/s, pipeline authority) · projected at ${SINK_RATE_MS} m/s sink — ` +
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
    title: "One document, a second sink rate — no republication",
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
        `${agreement.unanimous ? " — unanimous" : ""}; start spread ` +
        `${JSON.stringify(agreement.timing.startSpreadHours)} (clipped edges abstain)`,
    },
    ...(heightSpread
      ? [
          {
            term: "heightSpread",
            text:
              `${heightSpread.spreadM} m between peaks the models place ` +
              `${heightSpread.peaks.map((entry) => `at ${localTime(entry.at.local)}`).join(" and ")}` +
              " — the same height, two hours apart, stated without a consensus",
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
      "Charts and verdict are computed at figure-generation time from the committed comparison pair (re-slugged so each document keeps its own analysis). An edge clipped by a document's horizon reads as “open since at least” and stays out of the timing spread — which is why this pair's start spread is reported as null rather than a number no model stated.",
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
      "Rendered by the released package — validate, build a scene, serialize the chart, then derive the key from that final scene. Swap the committed teaching profile for your published one and the code below is the whole program.",
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
      source: `scene.strips[] — ${stripKeys}`,
      detail: "one MetricStrip per row with top, height, min/max, and line/area/band paths",
    },
  ];

  const legendEntries = [
    ...regions.map((region) => ({
      n: region.n,
      text: `${region.name} — ${region.source}: ${region.detail}`,
    })),
    ...(scene.launch
      ? [
          {
            n: 5,
            text: `Launch line — scene.launch: y, altitude, and label for the launch supplied at render time via MeteogramOptions.launch (${scene.launch.label})`,
          },
        ]
      : []),
    {
      n: 6,
      text: "Selected hour — scene.selectedHourIndex: the day's peak-W* column, highlighted by the selectedHour overlay",
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
      "Region boxes are positioned from this scene's own scales and strip geometry at figure-generation time — scene.scales places the plot, each MetricStrip carries its top and height, and the launch line and selected hour are scene fields, not renderer guesses. The launch itself is a render input (MeteogramOptions.launch, supplied at render time) — the document carries none.",
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
      text: "Selection column — scene.selection.x · width · top · bottom: the tinted column and its span, strips to plot floor (meteo-gram-selection-column)",
    },
    {
      n: 2,
      text: "Hairline — scene.selection.centerX: the column-centre time line (meteo-gram-selection-line)",
    },
    ...(selection.barb
      ? [
          {
            n: 3,
            text: "Barb ring — scene.selection.barb: the requested altitude snapped to the nearest drawn barb, ringed at its drawn position (meteo-gram-selection-ring, themed by --meteo-gram-selection)",
          },
        ]
      : []),
    {
      n: 4,
      muted: true,
      text: "Not the selection — scene.selectedHourIndex: the scene's own computed peak-W* highlight, a different fact with its own toggle",
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
      "Pass selection to buildMeteogramScene and the reference render marks it — the inspector and the pixels share one authority.",
    description: `A rendered teaching Meteogram whose build received selection: { hourIndex: ${selection.hourIndex}, altitudeM: ${Math.round(target?.altitudeM ?? 0)} }. The serializer drew the tinted selection column with its centre hairline, and a ring on the drawn wind barb the requested altitude snapped to. The scene's own computed best-hour highlight is visible on a different column.`,
    caption: `scene.selection resolved the ring to the drawn barb at ${Math.round(selection.barb?.altitudeM ?? 0)} m — the nearest DRAWN barb to the request, the same answer nearestDrawnBarb gives. The paler highlight at hour ${scene.selectedHourIndex} is scene.selectedHourIndex, the computed peak-W* column: the two marks are different facts.`,
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
    title: "Same scene, same bytes — two token sets",
    lesson:
      "Palette is not scene data: a downstream look is CSS custom properties on an ancestor, never a forked serializer.",
    description:
      "The same teaching Meteogram rendered twice from one scene. The left panel uses the package's default tokens; the right panel resolves the same markup with surface, ink, temperature, and halo tokens overridden to a dark club palette. The scene geometry of both panels is identical.",
    caption:
      "Both panels serialize the same DEFAULT_STYLESHEET; the right panel only swaps the resolved values of --meteo-gram-surface, --meteo-gram-strip-bg, --meteo-gram-ink, --meteo-gram-ink-soft, --meteo-gram-ink-mute, --meteo-gram-rule, --meteo-gram-temp, --meteo-gram-halo, and --meteo-gram-halo-barb — the ancestor-override path the page documents. In this committed plate each panel is pinned to its resolved values, so the demonstration itself never restyles with the page around it.",
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

  parts.push(heading(y, `Stability ramp — STABILITY_TOKEN_DEFAULTS`));
  y += 12;
  const ramp = grid(stability, y);
  parts.push(ramp.markup);
  y += ramp.height + 22;

  parts.push(heading(y, "Scene defaults — DEFAULT_CAPE_CLASSES · DEFAULT_OVERLAYS"));
  y += 18;
  const lineSpec = { family: "ibm-plex-mono", weight: 400, size: 10.5 };
  const sceneLines = [
    `CAPE strip classes: watch from ${DEFAULT_CAPE_CLASSES.watchJkg}, risk from ${DEFAULT_CAPE_CLASSES.riskJkg}, severe from ${DEFAULT_CAPE_CLASSES.severeJkg} J/kg; a cell dims when CIN is at or below ${DEFAULT_CAPE_CLASSES.cappedCinJkg} J/kg.`,
    `Overlays defaulting on (${overlaysOn.length}): ${overlaysOn.join(", ")}.`,
    `Defaulting off (${overlaysOff.length}): ${overlaysOff.join(", ")}.`,
  ].flatMap((line) => wrapText(line, width, lineSpec));
  parts.push(wrapped(0, y, sceneLines, { font: MONO, size: 10.5, fill: INK_SOFT }, 15));
  y += sceneLines.length * 15 + 16;

  parts.push(heading(y, `Renderer tokens — TOKEN_DEFAULTS (${tokens.length})`));
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

export const PAGE_FIGURE_TARGETS = [
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
    id: "docs-publication-flow",
    file: "forecast/docs/figures/publication-flow.svg",
    compose: composePublicationFlow,
  },
  {
    id: "docs-two-transports",
    file: "forecast/docs/figures/two-transports.svg",
    compose: composeTwoTransports,
  },
];
