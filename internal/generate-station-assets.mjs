import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importDist } from "./lib/import-dist.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const req = createRequire(join(root, "package.json"));
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const h = React.createElement;

const core = await importDist(root, "station");
const { CurrentConditions } = await importDist(root, "station/react");
const { EXHIBIT_THRESHOLDS, LAUNCH_RIDGE_META, mulberry32, smooth } = await importDist(
  root,
  "station/fixtures",
);
const words = core.defaultStrings;

const stylesCss = await readFile(join(root, "station/styles.css"), "utf8");

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let piece = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(piece.trim());
      piece = "";
    } else {
      piece += char;
    }
  }
  parts.push(piece.trim());
  return parts;
}

function resolveLightDark(value, arm) {
  let resolved = value;
  for (;;) {
    const start = resolved.indexOf("light-dark(");
    if (start === -1) return resolved;
    let depth = 0;
    let end = start + "light-dark".length;
    for (; end < resolved.length; end += 1) {
      if (resolved[end] === "(") depth += 1;
      if (resolved[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const inner = resolved.slice(start + "light-dark(".length, end);
    const [light, dark] = splitTopLevel(inner);
    resolved = resolved.slice(0, start) + (arm === "dark" ? dark : light) + resolved.slice(end + 1);
  }
}

/* Every declaration in styles.css's token block, one arm of each
   light-dark() resolved: [{ name: "--meteo-…", value }]. */
function parseTokenBlock(arm) {
  const marker = ":where(.meteo-root) {";
  const start = stylesCss.indexOf(marker);
  if (start === -1) throw new Error(`styles.css: token block not found: ${marker}`);
  const block = stylesCss.slice(start, stylesCss.indexOf("\n}", start));
  const tokens = [];
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.push({
      name: match[1],
      value: resolveLightDark(match[2].replace(/\s+/g, " ").trim(), arm),
    });
  }
  return tokens;
}

/* The style block's projection: keys are token names with their first
   `--meteo-` or `--wind-` prefix stripped. */
function parseTokens(arm) {
  const tokens = {};
  for (const { name, value } of parseTokenBlock(arm)) {
    const short = name.match(/^--(?:meteo|wind)-([a-z0-9-]+)$/)?.[1];
    if (short !== undefined) tokens[short] = value;
  }
  return tokens;
}

const THEMES = {
  light: parseTokens("light"),
  dark: parseTokens("dark"),
};

function darken(hex, keep = 0.72) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) =>
    Math.round(((value >> shift) & 0xff) * keep)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function styleBlock(t) {
  const bands = [0, 1, 2, 3, 4].map((band) => t[`band-${band}`]);
  const perBand = (selector, property) =>
    bands.map((color, band) => `${selector}.meteo-band-${band}{${property}:${color}}`).join("\n");
  return `<style>
text{font-family:${t.font};font-size:10.5px;fill:${t.muted}}
.meteo-wind-dial-face{fill:${t["surface-raised"]}}
.meteo-wind-dial-bezel-in{stop-color:${t["surface-raised"]};stop-opacity:0}
.meteo-wind-dial-bezel-out{stop-color:${t.ink};stop-opacity:0.1}
.meteo-wind-dial-ring{fill:none;stroke:${t.border};stroke-width:1.5}
.meteo-wind-dial-arc{fill:none;stroke:${t.accent};stroke-width:5.5;stroke-linecap:round}
${perBand(".meteo-wind-dial-arc", "stroke")}
.meteo-wind-dial-tick{stroke:${t.muted};stroke-width:1;opacity:0.55}
.meteo-wind-dial-tick-cardinal{stroke:${t.ink};stroke-width:2;opacity:0.9}
.meteo-wind-dial-letter{font-size:11px;font-weight:600;fill:${t.muted}}
.meteo-wind-needle-blade{fill:${t.accent}}
.meteo-wind-needle-counterweight{fill:${t.accent}}
.meteo-wind-dial-hub{fill:${t["surface-raised"]};stroke:${t.border};stroke-width:1.5}
.meteo-wind-dial-speed{font-size:37px;font-weight:750;fill:${t.ink}}
.meteo-wind-dial-unit{font-size:10px;fill:${t.muted}}
.meteo-grid-line{stroke:${t.grid};stroke-width:1}
.meteo-wind-zone{stroke:none;fill-opacity:0.05}
${perBand(".meteo-wind-zone", "fill")}
.meteo-wind-threshold{stroke-width:1;stroke-dasharray:2 5;opacity:0.7}
${perBand(".meteo-wind-threshold", "stroke")}
.meteo-wind-threshold-label{font-size:9px;font-weight:650}
${perBand(".meteo-wind-threshold-label", "fill")}
.meteo-wind-guide{stroke:${t.grid};stroke-width:1;stroke-dasharray:1 4}
.meteo-wind-band{fill:${t["wind-band-fill"]};stroke:none}
.meteo-wind-mean-segment{fill:none;stroke-width:3.5;stroke-linecap:round}
${perBand(".meteo-wind-mean-segment", "stroke")}
.meteo-wind-row-label{font-size:9px;letter-spacing:0.08em}
.meteo-wind-vane-label{font-size:9px}
.meteo-wind-vane-value{font-size:9px}
.meteo-wind-vane{fill:none;stroke:${t["wind-vane"]};stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.meteo-wind-gap-hatch{stroke:${t.gap};stroke-width:1.25}
.meteo-wind-rose-grid{fill:none;stroke:${t.grid};stroke-width:1}
.meteo-wind-rose-tick{stroke:${t.muted};stroke-width:1;opacity:0.35}
.meteo-wind-rose-letter{font-size:12.5px;font-weight:650;fill:${t.ink}}
.meteo-wind-rose-ring-label{font-size:8.5px;fill:${t.muted}}
.meteo-wind-rose-petal{fill:${t.accent};fill-opacity:0.85;stroke:${darken(t.accent)};stroke-width:1;stroke-linejoin:round}
${bands
  .map(
    (color, band) =>
      `.meteo-wind-rose-petal.meteo-band-${band}{fill:${color};stroke:${darken(color)}}`,
  )
  .join("\n")}
.meteo-wind-rose-hub{fill:${t.surface};stroke:${t.border};stroke-width:1}
.meteo-wind-rose-dot{fill:${t.muted}}
.hw-card{fill:${t.surface};stroke:${t.border};stroke-width:1}
.hw-raised{fill:${t["surface-raised"]}}
.hw-border{stroke:${t.border};stroke-width:1}
.hw-name{font-size:20px;font-weight:700;fill:${t.ink};letter-spacing:-0.2px}
.hw-meta{font-size:12px;fill:${t.muted}}
.hw-micro{font-size:10px;font-weight:600;letter-spacing:0.08em;fill:${t.muted}}
.hw-big{font-size:22px;font-weight:700;fill:${t.ink}}
.hw-strong{font-size:14px;font-weight:650;fill:${t.ink}}
.hw-dim{font-size:13px;fill:${t.muted}}
.hw-accent-strong{font-size:12px;font-weight:700;fill:${t.accent}}
.hw-italic{font-size:12px;font-style:italic;fill:${t.muted}}
.hw-pill{fill:${t["freshness-live"]};fill-opacity:0.13}
.hw-pill-dot{fill:${t["freshness-live"]}}
.hw-pill-text{font-size:12px;font-weight:600;fill:${t["freshness-live"]}}
.hw-vane-accent{fill:none;stroke:${t.accent};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hw-table-strong{font-size:13px;font-weight:650;fill:${t.ink}}
.hw-table-num{font-size:14px;font-weight:700;fill:${t.ink}}
.hw-wordmark{font-size:44px;font-weight:600;letter-spacing:-1.2px;fill:${t.ink}}
.hw-wordmark-sub{font-size:12px;font-weight:650;letter-spacing:0.34em;fill:${t.muted}}
</style>`;
}

const NOW_MS = Date.parse("2025-06-21T20:00:00Z");
const TZ_OFFSET_MS = -7 * 3_600_000;
const PERIOD_MINUTES = 5;
const THRESHOLDS = EXHIBIT_THRESHOLDS.values.map((kmh) => kmh / 3.6);

const iso = (ms) => new Date(ms).toISOString();
const mps = (kmh) => Math.round((kmh / 3.6) * 100) / 100;
const shownKmh = (valueMps) => Math.round(core.speedFromMps(valueMps, "kmh"));
const fmtTime = (ms) => {
  const local = new Date(ms + TZ_OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};
const round1 = (value) => Math.round(value * 10) / 10;

function buildHistory() {
  const rand = mulberry32(0x57a71c);
  const points = [];
  for (let index = 0; index <= 72; index += 1) {
    const t = index / 72;
    const build = smooth((t - 0.15) / 0.7);
    const gustiness = 1 + 4 * build;
    const average = Math.max(0.2, 1.2 + 17.6 * build + (rand() - 0.5) * (1 + 3 * build));
    const gust = average + gustiness * (0.9 + 0.7 * rand()) + 1;
    const lull = Math.max(0, average - gustiness * (0.7 + 0.5 * rand()) - 0.5);
    const bearing = 110 + 205 * smooth((t - 0.08) / 0.8) + (rand() - 0.5) * 24;
    points.push({
      observedAt: iso(NOW_MS - (72 - index) * PERIOD_MINUTES * 60_000),
      windAvgMps: mps(average),
      windGustMps: mps(gust),
      windLullMps: mps(lull),
      windDirectionDeg: core.isCalm(mps(average)) ? null : round1(core.normalizeDegrees(bearing)),
      temperatureC: null,
    });
  }
  return { periodMinutes: PERIOD_MINUTES, points };
}

const HISTORY = buildHistory();

const READING = {
  observedAt: iso(NOW_MS - 30_000),
  windAvgMps: mps(17.3),
  windDirectionDeg: 313,
  windGustMps: mps(24.1),
  windLullMps: mps(11.2),
  temperatureC: null,
  windChillC: null,
  conditions: null,
};

const STATION = {
  ...LAUNCH_RIDGE_META,
  /* Wind-only on purpose: the hero figure shows the dial-and-history face,
     so temperature stays off here even though the live exhibit reports it. */
  capabilities: { ...LAUNCH_RIDGE_META.capabilities, temperature: false },
  status: "ok",
  reading: READING,
  history: HISTORY,
};

core.stationSchema.parse(STATION);

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (value) => String(Math.round(value * 10) / 10);
const text = (x, y, cls, content, anchor) =>
  `<text class="${cls}" x="${n(x)}" y="${n(y)}"${anchor ? ` text-anchor="${anchor}"` : ""}>${esc(content)}</text>`;

const svgDocument = (width, height, theme, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${styleBlock(THEMES[theme])}${body}</svg>`;

function extractSvg(markup, className, x, y) {
  const marker = markup.indexOf(`class="${className}"`);
  if (marker === -1) throw new Error(`render carries no <svg class="${className}">`);
  const open = markup.lastIndexOf("<svg", marker);
  const close = markup.indexOf("</svg>", marker) + "</svg>".length;
  return `<svg x="${n(x)}" y="${n(y)}"${markup.slice(open + 4, close)}`;
}

function cardChrome(width, height, headerBottom, radius = 14) {
  const inner = radius - 1;
  return (
    `<rect class="hw-card" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}"/>` +
    `<path class="hw-raised" d="M1,${headerBottom} v-${headerBottom - 1 - inner} a${inner},${inner} 0 0 1 ${inner},-${inner} h${width - 2 - 2 * inner} a${inner},${inner} 0 0 1 ${inner},${inner} v${headerBottom - 1 - inner} z"/>` +
    `<line class="hw-border" x1="1" y1="${headerBottom}" x2="${width - 1}" y2="${headerBottom}"/>`
  );
}

function directionRow(cx, y, bearingDeg) {
  const compass = core.compassDirection(bearingDeg);
  return (
    text(cx - 23, y, "hw-dim", words.fromLabel, "end") +
    `<path class="hw-vane-accent" d="${core.vanePath(cx - 9, y - 5, bearingDeg, { reach: 6.5, spread: 3 })}"/>` +
    `<text x="${n(cx + 5)}" y="${n(y)}"><tspan class="hw-strong">${esc(compass)}</tspan><tspan class="hw-dim"> ${Math.round(bearingDeg)}°</tspan></text>`
  );
}

function flank(cx, cy, label, valueKmh) {
  return (
    text(cx, cy, "hw-micro", label.toUpperCase(), "middle") +
    text(cx, cy + 26, "hw-big", Math.round(valueKmh), "middle")
  );
}

function plotSvg({
  points,
  thresholds,
  width,
  x,
  y,
  idPrefix,
  gapRangesMs,
  withBand,
  vaneValue,
  formatTick,
}) {
  const frame = core.chartFrame(width);
  const scales = core.chartScales(points, frame);
  const vanes = core.thinVanes(points);
  const parts = [];

  const cuts = [0, ...thresholds.filter((b) => b > 0 && b < scales.scaleMax), scales.scaleMax];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const [lower, upper] = [cuts[index], cuts[index + 1]];
    const band = core.speedBand((lower + upper) / 2, thresholds);
    parts.push(
      `<rect class="meteo-wind-zone meteo-band-${band}" x="${n(frame.left)}" y="${n(scales.yAt(upper))}" width="${n(frame.right - frame.left)}" height="${n(scales.yAt(lower) - scales.yAt(upper))}"/>`,
    );
  }
  for (const fraction of [0, 0.5, 1]) {
    const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
    parts.push(
      `<line class="meteo-grid-line" x1="${n(frame.left)}" y1="${n(gridY)}" x2="${n(frame.right)}" y2="${n(gridY)}"/>`,
      text(
        frame.left - 6,
        gridY + 5,
        "meteo-grid-label",
        shownKmh(scales.scaleMax * fraction),
        "end",
      ),
    );
  }
  for (const bound of thresholds.filter((b) => b > 0 && b <= scales.scaleMax)) {
    const band = core.speedBand(bound, thresholds);
    parts.push(
      `<line class="meteo-wind-threshold meteo-band-${band}" x1="${n(frame.left)}" y1="${n(scales.yAt(bound))}" x2="${n(frame.right)}" y2="${n(scales.yAt(bound))}"/>`,
      text(
        frame.right - 3,
        scales.yAt(bound) - 3,
        `meteo-wind-threshold-label meteo-band-${band}`,
        shownKmh(bound),
        "end",
      ),
    );
  }
  for (const vane of vanes) {
    parts.push(
      `<line class="meteo-wind-guide" x1="${n(scales.xAtMs(vane.midMs))}" y1="${n(frame.plotTop)}" x2="${n(scales.xAtMs(vane.midMs))}" y2="${n(frame.vaneRow - 9)}"/>`,
    );
  }
  const gaps = gapRangesMs();
  if (gaps.length > 0) {
    parts.push(
      `<defs><pattern id="${idPrefix}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="meteo-wind-gap-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`,
      ...gaps.map(
        ([startMs, endMs]) =>
          `<rect fill="url(#${idPrefix}-hatch)" x="${n(scales.xAtMs(startMs))}" y="${n(frame.plotTop)}" width="${n(scales.xAtMs(endMs) - scales.xAtMs(startMs))}" height="${n(frame.plotBottom - frame.plotTop)}"/>`,
      ),
    );
  }
  if (withBand) {
    const band = core.bandPoints(points, scales);
    if (band != null) parts.push(`<polygon class="meteo-wind-band" points="${band}"/>`);
  }
  for (let index = 1; index < points.length; index += 1) {
    const [previous, point] = [points[index - 1], points[index]];
    const segmentBand = core.speedBand((previous.windAvgMps + point.windAvgMps) / 2, thresholds);
    parts.push(
      `<line class="meteo-wind-mean-segment meteo-band-${segmentBand}" x1="${n(scales.xAt(previous.observedAt))}" y1="${n(scales.yAt(previous.windAvgMps))}" x2="${n(scales.xAt(point.observedAt))}" y2="${n(scales.yAt(point.windAvgMps))}"/>`,
    );
  }
  parts.push(text(frame.left - 8, frame.vaneRow + 4, "meteo-wind-row-label", words.toLabel, "end"));
  for (const vane of vanes) {
    parts.push(
      vane.windDirectionDeg == null
        ? text(scales.xAtMs(vane.midMs), frame.vaneRow + 4, "meteo-wind-vane-calm", "—", "middle")
        : `<path class="meteo-wind-vane" d="${core.vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.windDirectionDeg)}"/>`,
    );
  }
  for (const vane of vanes) {
    parts.push(
      text(
        scales.xAtMs(vane.midMs),
        frame.vaneLabelRow + 4,
        "meteo-wind-vane-label",
        vane.windDirectionDeg == null ? "—" : core.compassDirection(vane.windDirectionDeg),
        "middle",
      ),
    );
  }
  parts.push(
    text(frame.left - 8, frame.valueRow + 4, "meteo-wind-row-label", words.avgLabel, "end"),
  );
  for (const vane of vanes) {
    parts.push(
      text(
        scales.xAtMs(vane.midMs),
        frame.valueRow + 4,
        "meteo-wind-vane-value",
        vaneValue(vane),
        "middle",
      ),
    );
  }
  for (const tick of core.vaneTicks(vanes, scales)) {
    const anchor = tick.index === 0 ? "start" : tick.index === 4 ? "end" : "middle";
    parts.push(text(tick.x, frame.labelRow, "meteo-tick", formatTick(tick.timeMs), anchor));
  }
  return `<svg x="${n(x)}" y="${n(y)}" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">${parts.join("")}</svg>`;
}

function chartSvg({ points, periodMinutes, thresholds, width, x, y, idPrefix }) {
  return plotSvg({
    points,
    thresholds,
    width,
    x,
    y,
    idPrefix,
    gapRangesMs: () => core.historyGaps({ periodMinutes, points }),
    withBand: true,
    vaneValue: (vane) => shownKmh(vane.windAvgMps),
    formatTick: fmtTime,
  });
}

function renderDial() {
  return renderToStaticMarkup(
    h(CurrentConditions, {
      station: STATION,
      servedAt: iso(NOW_MS),
      receivedAtMs: NOW_MS,
      thresholds: EXHIBIT_THRESHOLDS,
    }),
  );
}

function heroSvg(theme) {
  const status = core.freshness({
    observedAt: READING.observedAt,
    servedAt: iso(NOW_MS),
    receivedAtMs: NOW_MS,
    nowMs: NOW_MS,
  });
  const startMs = Date.parse(HISTORY.points[0].observedAt);
  const body =
    `<g transform="translate(10,10)">` +
    cardChrome(880, 340, 56) +
    text(24, 30, "hw-name", STATION.name) +
    text(
      24,
      47,
      "hw-meta",
      `${STATION.sourceLabel} · ${words.elevation(STATION.elevationM)} · updated ${fmtTime(NOW_MS)}`,
    ) +
    `<rect class="hw-pill" x="790" y="15" width="66" height="26" rx="13"/>` +
    `<circle class="hw-pill-dot" cx="806" cy="28" r="4"/>` +
    text(818, 32, "hw-pill-text", words.freshness[status]) +
    `<line class="meteo-grid-line" x1="326" y1="82" x2="326" y2="322"/>` +
    flank(43, 174, words.lullLabel, shownKmh(READING.windLullMps)) +
    extractSvg(renderDial(), "meteo-wind-dial", 71, 102) +
    flank(259, 174, words.gustLabel, shownKmh(READING.windGustMps)) +
    directionRow(151, 294, READING.windDirectionDeg) +
    `<text x="386" y="104"><tspan class="hw-accent-strong">${fmtTime(startMs)} – ${fmtTime(NOW_MS)}</tspan><tspan class="hw-meta"> · lull–gust band · vanes point downwind</tspan></text>` +
    chartSvg({
      points: HISTORY.points,
      periodMinutes: HISTORY.periodMinutes,
      thresholds: THRESHOLDS,
      width: 524,
      x: 340,
      y: 116,
      idPrefix: "hero",
    }) +
    `</g>`;
  return svgDocument(
    900,
    360,
    theme,
    `Live wind at ${STATION.name}: instrument dial and six-hour graded history`,
    body,
  );
}

function assertWellFormed(name, xml) {
  const stack = [];
  const scanner =
    /<!--[\s\S]*?-->|<(\/?)([A-Za-z_][A-Za-z0-9_.:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*?)(\/?)>|[<>]/g;
  let match;
  while ((match = scanner.exec(xml)) !== null) {
    if (match[0] === "<" || match[0] === ">") {
      throw new Error(`${name}: stray ${JSON.stringify(match[0])} at offset ${match.index}`);
    }
    if (match[0].startsWith("<!--")) continue;
    const [, closing, tag, , selfClosing] = match;
    if (closing) {
      const expected = stack.pop();
      if (expected !== tag) throw new Error(`${name}: </${tag}> closes <${expected}>`);
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  if (stack.length > 0) throw new Error(`${name}: unclosed <${stack.join("<")}>`);
  const badEntity = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.exec(xml);
  if (badEntity) throw new Error(`${name}: unescaped & at offset ${badEntity.index}`);
}

function assertSelfContained(name, svg) {
  if (/<foreignObject/i.test(svg)) throw new Error(`${name}: foreignObject`);
  if (/url\((?!#)/.test(svg)) throw new Error(`${name}: non-fragment url() reference`);
  if (/https?:\/\//.test(svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', ""))) {
    throw new Error(`${name}: external http reference`);
  }
  if (/@import|<image|<script/i.test(svg)) throw new Error(`${name}: external content`);
  const bytes = Buffer.byteLength(svg);
  if (bytes > 200 * 1024) throw new Error(`${name}: ${bytes} bytes exceeds 200 KB`);
  assertWellFormed(name, svg);
  return bytes;
}

/* The token map draws every documented token from styles.css itself, both
   arms of each light-dark() declaration, so the theming page can show its
   palette without copying a value into prose. Fixed literal colors on
   purpose: the figure depicts station's own palette, which never follows
   the website theme. */
function tokenMapSvg() {
  const light = parseTokenBlock("light");
  const dark = new Map(parseTokenBlock("dark").map((token) => [token.name, token.value]));
  const isColor = (value) => /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/.test(value);

  const groupOf = (name) => {
    if (name.startsWith("--meteo-band-")) return "Band ramp";
    if (name.startsWith("--meteo-freshness-")) return "Freshness states";
    if (name.startsWith("--meteo-wind-") || name === "--meteo-cursor") {
      return "Chart and wind encoding";
    }
    return "Chrome and identity";
  };
  const groupOrder = [
    "Chrome and identity",
    "Freshness states",
    "Chart and wind encoding",
    "Band ramp",
  ];

  const colorTokens = light.filter((token) => isColor(token.value));
  const otherTokens = light.filter((token) => !isColor(token.value));

  const width = 880;
  const nameX = 24;
  const panels = [
    { label: "light arm", x: 396, bg: "#ffffff", border: "#dbe2e9", ink: "#17232e" },
    { label: "dark arm", x: 636, bg: "#10161d", border: "#2b3844", ink: "#e7edf3" },
  ];
  const panelW = 220;
  const rowH = 24;
  const mono = 'font-family="ui-monospace, SFMono-Regular, Menlo, monospace"';
  const sans = 'font-family="ui-sans-serif, system-ui, sans-serif"';

  const rows = [];
  let y = 88;
  const groupSpans = [];
  for (const group of groupOrder) {
    const members = colorTokens.filter((token) => groupOf(token.name) === group);
    if (members.length === 0) continue;
    rows.push(
      `<text ${sans} font-size="11" font-weight="650" letter-spacing="0.08em" fill="#62717f" x="${nameX}" y="${y}">${esc(group.toUpperCase())}</text>`,
    );
    y += 14;
    const groupTop = y;
    for (const token of members) {
      const rowMid = y + rowH / 2;
      rows.push(
        `<text ${mono} font-size="12.5" fill="#17232e" x="${nameX}" y="${n(rowMid + 4)}">${esc(token.name)}</text>`,
      );
      for (const panel of panels) {
        const value = panel.label === "light arm" ? token.value : dark.get(token.name);
        rows.push(
          `<rect x="${panel.x + 14}" y="${n(rowMid - 8)}" width="16" height="16" rx="3" fill="${esc(value)}" stroke="${panel.border}"/>`,
          `<text ${mono} font-size="10.5" fill="${panel.ink}" x="${panel.x + 38}" y="${n(rowMid + 4)}">${esc(value)}</text>`,
        );
      }
      y += rowH;
    }
    groupSpans.push({ top: groupTop, bottom: y });
    y += 12;
  }

  const footerTop = y + 6;
  let fy = footerTop + 16;
  const footer = [
    `<text ${sans} font-size="11" font-weight="650" letter-spacing="0.08em" fill="#62717f" x="${nameX}" y="${fy}">NON-COLOUR TOKENS (LIGHT ARM WHERE TWO EXIST)</text>`,
  ];
  fy += 8;
  for (const token of otherTokens) {
    fy += 20;
    const shown = token.value.length > 76 ? `${token.value.slice(0, 73)}…` : token.value;
    footer.push(
      `<text ${mono} font-size="12" fill="#17232e" x="${nameX}" y="${fy}">${esc(token.name)}</text>`,
      `<text ${mono} font-size="10.5" fill="#62717f" x="248" y="${fy}">${esc(shown)}</text>`,
    );
  }
  const height = fy + 26;

  const panelRects = panels
    .map((panel) =>
      groupSpans
        .map(
          (span) =>
            `<rect x="${panel.x}" y="${n(span.top - 2)}" width="${panelW}" height="${n(span.bottom - span.top + 4)}" rx="6" fill="${panel.bg}" stroke="${panel.border}"/>`,
        )
        .join(""),
    )
    .join("");

  const header =
    `<text ${sans} font-size="19" font-weight="700" fill="#17232e" x="${nameX}" y="38">Station theme tokens</text>` +
    `<text ${sans} font-size="12.5" fill="#62717f" x="${nameX}" y="58">Each token is one light-dark() declaration in styles.css; both arms shown, resolved from the stylesheet.</text>` +
    panels
      .map(
        (panel) =>
          `<text ${mono} font-size="11.5" font-weight="650" fill="#62717f" x="${panel.x + 14}" y="80">${esc(panel.label)}</text>`,
      )
      .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${n(height)}" viewBox="0 0 ${width} ${n(height)}" role="img" aria-label="Every station theme token from styles.css with its light and dark values shown as labelled colour swatches, grouped into chrome, freshness states, chart and wind encoding, and the five-step band ramp; font, radius, and shadow listed as text.">` +
    `<rect width="${width}" height="${n(height)}" rx="14" fill="#f4f6f9"/>` +
    `<rect x="1" y="1" width="${width - 2}" height="${n(height - 2)}" rx="13" fill="none" stroke="#dbe2e9" stroke-width="2"/>` +
    header +
    panelRects +
    rows.join("") +
    footer.join("") +
    `</svg>`
  );
}

const ASSETS = {
  "hero-light.svg": heroSvg("light"),
  "hero-dark.svg": heroSvg("dark"),
  "token-map.svg": tokenMapSvg(),
};

const check = process.argv.includes("--check");

if (check) {
  const drift = [];
  for (const [name, svg] of Object.entries(ASSETS)) {
    assertSelfContained(name, `${svg}\n`);
    const committed = await readFile(join(root, "station", "docs", "figures", name), "utf8").catch(
      () => null,
    );
    if (committed === `${svg}\n`) {
      console.log(`ok    station/docs/figures/${name}`);
    } else {
      drift.push(`station/docs/figures/${name}`);
      console.log(`DRIFT station/docs/figures/${name}${committed === null ? " (missing)" : ""}`);
      if (committed !== null) {
        let at = 0;
        while (at < committed.length && committed[at] === svg[at]) at += 1;
        const window = (value) => JSON.stringify(value.slice(Math.max(0, at - 80), at + 120));
        console.log(`      first difference at offset ${at}`);
        console.log(`      committed   ${window(committed)}`);
        console.log(`      regenerated ${window(svg)}`);
      }
    }
  }
  if (drift.length > 0) {
    console.error(`\nStation assets drifted from the renderer: ${drift.join(", ")}`);
    console.error("Regenerate with: pnpm station-assets");
    process.exit(1);
  }
} else {
  await mkdir(join(root, "station", "docs", "figures"), { recursive: true });
  for (const [name, svg] of Object.entries(ASSETS)) {
    const bytes = assertSelfContained(name, `${svg}\n`);
    await writeFile(join(root, "station", "docs", "figures", name), `${svg}\n`);
    console.log(`station/docs/figures/${name}  ${(bytes / 1024).toFixed(1)} KB`);
  }
}
