import { short } from "../../scene/path.js";
import type { SoundingKeySpec } from "../scene/key.js";
import type { SoundingBarb, SoundingScene } from "../scene/types.js";
import { DEFAULT_SOUNDING_STYLESHEET } from "./theme.js";

export {
  DEFAULT_SOUNDING_STYLESHEET,
  SOUNDING_MARK_TOKENS,
  SOUNDING_TOKEN_DEFAULTS,
  SOUNDING_TRACE_TOKENS,
} from "./theme.js";

export interface RenderSoundingSvgOptions {
  /** Stylesheet embedded in a <style> block; defaults to DEFAULT_SOUNDING_STYLESHEET, and null omits it. */
  stylesheet?: string | null;
  /** Prefix for generated element ids — give each sounding on a page its own. Default "meteo-sounding". */
  idPrefix?: string;
}

type AttrValue = string | number;

function el(tag: string, attrs: Record<string, AttrValue>, children?: string): string {
  const rendered = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("");
  if (children === undefined) return `<${tag}${rendered}/>`;
  return `<${tag}${rendered}>${children}</${tag}>`;
}

function text(attrs: Record<string, AttrValue>, content: string): string {
  return el("text", attrs, escapeXml(content));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const DOT_RADIUS = 2.6;
const LCL_RADIUS = 3.2;

function renderBarb(barb: SoundingBarb, barbX: number): string {
  if (barb.calm) {
    return el("circle", {
      cx: short(barbX),
      cy: short(barb.y),
      r: 3.6,
      class: "meteo-sounding-barb",
      "stroke-width": 1.1,
      fill: "none",
    });
  }
  const parts: string[] = [
    el("path", {
      d: barb.shaftPath,
      class: "meteo-sounding-barb",
      "stroke-width": 1.3,
      fill: "none",
      "stroke-linecap": "round",
    }),
  ];
  for (const pennant of barb.pennantPaths) {
    parts.push(el("path", { d: pennant, class: "meteo-sounding-barb-fill", "stroke-width": 1 }));
  }
  return el(
    "g",
    {
      transform: `translate(${short(barbX)} ${short(barb.y)}) rotate(${short(barb.directionDeg)})`,
    },
    parts.join(""),
  );
}

/** Serializes a sounding scene to a self-contained, deterministic SVG document string. */
export function renderSoundingSvg(
  scene: SoundingScene,
  options: RenderSoundingSvgOptions = {},
): string {
  const stylesheet =
    options.stylesheet === undefined ? DEFAULT_SOUNDING_STYLESHEET : options.stylesheet;
  const { plotLeft, plotTop, plotWidth, plotHeight, barbX } = scene.scales;
  const plotBottom = plotTop + plotHeight;
  const plotRight = plotLeft + plotWidth;
  const body: string[] = [];

  if (stylesheet) body.push(el("style", {}, `\n${stylesheet}\n`));

  body.push(
    el("rect", {
      x: plotLeft,
      y: plotTop,
      width: plotWidth,
      height: plotHeight,
      class: "meteo-sounding-frame",
    }),
  );

  for (const tick of scene.axes.altitude) {
    body.push(
      el("line", {
        x1: plotLeft,
        y1: short(tick.y),
        x2: plotRight,
        y2: short(tick.y),
        class: "meteo-sounding-gridline",
        "stroke-width": 1,
        opacity: 0.35,
      }),
      text(
        {
          x: plotLeft - 8,
          y: short(tick.y + 3),
          "text-anchor": "end",
          class: "meteo-sounding-tick",
        },
        tick.labelMetres,
      ),
    );
  }

  body.push(
    text(
      { x: plotRight + 8, y: plotTop - 6, class: "meteo-sounding-unit meteo-sounding-mono" },
      "hPa",
    ),
  );
  for (const tick of scene.axes.pressureAltitude) {
    if (tick.pressureHpa === null) continue;
    body.push(
      el("line", {
        x1: plotRight,
        y1: short(tick.y),
        x2: plotRight + 4,
        y2: short(tick.y),
        class: "meteo-sounding-gridline",
        "stroke-width": 1,
      }),
      text(
        {
          x: plotRight + 8,
          y: short(tick.y + 3),
          class: "meteo-sounding-tick meteo-sounding-mono",
        },
        String(tick.pressureHpa),
      ),
    );
  }

  for (const tick of scene.axes.temperature) {
    body.push(
      el("line", {
        x1: short(tick.x),
        x2: short(tick.x),
        y1: plotTop,
        y2: plotBottom,
        class: "meteo-sounding-gridline",
        "stroke-width": 0.6,
        opacity: 0.18,
      }),
      text(
        {
          x: short(tick.x),
          y: plotBottom + 16,
          "text-anchor": "middle",
          class: "meteo-sounding-tick meteo-sounding-mono",
        },
        tick.label,
      ),
    );
  }
  body.push(
    text(
      {
        x: short(plotLeft + plotWidth / 2),
        y: plotBottom + 30,
        "text-anchor": "middle",
        class: "meteo-sounding-unit",
      },
      "°C",
    ),
  );
  if (scene.barbs.length > 0) {
    body.push(
      text(
        {
          x: short(barbX),
          y: plotTop - 6,
          "text-anchor": "middle",
          class: "meteo-sounding-unit meteo-sounding-mono",
        },
        "km/h",
      ),
    );
  }

  for (const mark of scene.marks) {
    if (mark.band) {
      body.push(
        el("rect", {
          x: plotLeft,
          y: short(mark.band.yHigh),
          width: plotWidth,
          height: short(Math.max(0, mark.band.yLow - mark.band.yHigh)),
          class: `${mark.className}-band`,
        }),
      );
    }
    const line: Record<string, AttrValue> = {
      x1: plotLeft,
      x2: plotRight,
      y1: short(mark.y),
      y2: short(mark.y),
      class: mark.className,
      "stroke-width": 1.3,
    };
    if (mark.dash) line["stroke-dasharray"] = mark.dash;
    body.push(el("line", line));
  }

  for (const trace of scene.traces) {
    if (trace.bandPath) {
      body.push(el("path", { d: trace.bandPath, class: `${trace.className}-band` }));
    }
  }
  for (const trace of scene.traces) {
    if (trace.segmentPath !== "") {
      const attrs: Record<string, AttrValue> = {
        d: trace.segmentPath,
        class: trace.className,
        fill: "none",
        "stroke-width": trace.strokeWidth,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      };
      if (trace.dash) attrs["stroke-dasharray"] = trace.dash;
      body.push(el("path", attrs));
    }
    if (trace.key !== "parcel") {
      for (const sample of trace.samples) {
        body.push(
          el("circle", {
            cx: short(sample.x),
            cy: short(sample.y),
            r: DOT_RADIUS,
            class: `${trace.className}-dot`,
            "stroke-width": 1,
          }),
        );
      }
    }
    body.push(
      text(
        {
          x: short(trace.label.x),
          y: short(trace.label.y),
          "text-anchor": trace.label.anchor,
          class: `${trace.className}-label meteo-sounding-trace-label meteo-sounding-haloed-text`,
          "stroke-width": 2.5,
        },
        trace.label.text,
      ),
    );
  }

  if (scene.lcl) {
    body.push(
      el("circle", {
        cx: short(scene.lcl.x),
        cy: short(scene.lcl.y),
        r: LCL_RADIUS,
        class: "meteo-sounding-lcl",
        "stroke-width": 1.2,
      }),
      text(
        {
          // Above-right of the marker: the LCL often sits at the cloud-base
          // line, whose label hangs just above it at the plot's left edge.
          x: short(scene.lcl.x + 7),
          y: short(scene.lcl.y - 6),
          class: "meteo-sounding-lcl-label meteo-sounding-haloed-text",
          "stroke-width": 2.5,
        },
        scene.lcl.label,
      ),
    );
  }

  // Mark labels draw over the traces, not under them, so a trace crossing
  // the plot's left edge can never overpaint a printed altitude.
  for (const mark of scene.marks) {
    body.push(
      text(
        {
          x: plotLeft + 6,
          y: short(mark.y - 4),
          class: `${mark.className}-label meteo-sounding-mark-label meteo-sounding-haloed-text`,
          "stroke-width": 2.5,
        },
        mark.label,
      ),
    );
  }

  for (const barb of scene.barbs) body.push(renderBarb(barb, barbX));

  body.push(
    text(
      {
        x: short(plotLeft + plotWidth / 2),
        y: scene.height - 5,
        "text-anchor": "middle",
        class: "meteo-sounding-note",
      },
      scene.capNote,
    ),
  );

  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${short(scene.width)} ${short(scene.height)}`,
      role: "img",
      "aria-label": scene.ariaLabel,
      class: "meteo-sounding",
    },
    `\n${body.join("\n")}\n`,
  );
}

const KEY_PAD = 12;
const KEY_LABEL_CHAR_PX = 5.8;
const KEY_SWATCH_W = 26;
const KEY_CHIP_W = 24;
const KEY_CHIP_H = 9;
const KEY_LABEL_GAP = 6;
const KEY_ENTRY_GAP = 18;
const KEY_ROW_H = 26;

type KeyRowItem =
  | { kind: "line"; label: string; className: string; dash: string | null; strokeWidth: number }
  | { kind: "dot"; label: string; className: string }
  | { kind: "chip"; label: string; className: string };

function keyRowItems(spec: SoundingKeySpec): KeyRowItem[][] {
  const traces: KeyRowItem[] = spec.series.map((entry) => ({
    kind: "line" as const,
    label: entry.label,
    className: entry.className,
    dash: entry.dash,
    strokeWidth: entry.strokeWidth,
  }));
  if (spec.levelDot) {
    traces.push({
      kind: "dot",
      label: spec.levelDot.label,
      className: "meteo-sounding-temp-dot",
    });
  }
  if (spec.band)
    traces.push({ kind: "chip", label: spec.band.label, className: "meteo-sounding-key-band" });
  const marks: KeyRowItem[] = spec.marks.map((entry) => ({
    kind: "line" as const,
    label: entry.label,
    className: entry.className,
    dash: entry.dash,
    strokeWidth: 1.3,
  }));
  if (spec.lcl) marks.push({ kind: "dot", label: spec.lcl.label, className: "meteo-sounding-lcl" });
  return [traces, marks].filter((row) => row.length > 0);
}

/**
 * Serializes a sounding key spec (scene/buildSoundingKeySpec) to a
 * self-contained SVG string; swatches draw with each entry's real dash,
 * stroke width, and class, so the tokens theme the key exactly as they
 * theme the chart. Default `idPrefix` is "meteo-sounding-key".
 */
export function renderSoundingKeySvg(
  spec: SoundingKeySpec,
  options: RenderSoundingSvgOptions = {},
): string {
  const stylesheet =
    options.stylesheet === undefined ? DEFAULT_SOUNDING_STYLESHEET : options.stylesheet;
  const rows = keyRowItems(spec);
  const itemWidth = (item: KeyRowItem) =>
    (item.kind === "line" ? KEY_SWATCH_W : item.kind === "chip" ? KEY_CHIP_W : 2 * DOT_RADIUS + 4) +
    KEY_LABEL_GAP +
    Math.ceil(item.label.length * KEY_LABEL_CHAR_PX);
  const rowWidth = (row: KeyRowItem[]) =>
    row.reduce((sum, item) => sum + itemWidth(item), 0) +
    KEY_ENTRY_GAP * Math.max(row.length - 1, 0);
  const width = Math.max(...rows.map(rowWidth), 0) + 2 * KEY_PAD;
  const height = rows.length * KEY_ROW_H + 12;

  const body: string[] = [];
  if (stylesheet) body.push(el("style", {}, `\n${stylesheet}\n`));

  rows.forEach((row, rowIndex) => {
    let x = KEY_PAD;
    const swatchY = 6 + rowIndex * KEY_ROW_H + KEY_ROW_H / 2;
    for (const item of row) {
      if (item.kind === "line") {
        const attrs: Record<string, AttrValue> = {
          d: `M${short(x)} ${short(swatchY)} H${short(x + KEY_SWATCH_W)}`,
          class: item.className,
          fill: "none",
          "stroke-width": item.strokeWidth,
          "stroke-linecap": "round",
        };
        if (item.dash) attrs["stroke-dasharray"] = item.dash;
        body.push(el("path", attrs));
        x += KEY_SWATCH_W;
      } else if (item.kind === "dot") {
        body.push(
          el("circle", {
            cx: short(x + DOT_RADIUS + 2),
            cy: short(swatchY),
            r: DOT_RADIUS,
            class: item.className,
            "stroke-width": 1,
          }),
        );
        x += 2 * DOT_RADIUS + 4;
      } else {
        body.push(
          el("rect", {
            x: short(x),
            y: short(swatchY - KEY_CHIP_H / 2),
            width: KEY_CHIP_W,
            height: KEY_CHIP_H,
            class: item.className,
          }),
          el("rect", {
            x: short(x),
            y: short(swatchY - KEY_CHIP_H / 2),
            width: KEY_CHIP_W,
            height: KEY_CHIP_H,
            class: "meteo-sounding-key-frame",
            "stroke-width": 0.7,
          }),
        );
        x += KEY_CHIP_W;
      }
      x += KEY_LABEL_GAP;
      body.push(
        text(
          { x: short(x), y: short(swatchY + 3.5), class: "meteo-sounding-key-label" },
          item.label,
        ),
      );
      x += Math.ceil(item.label.length * KEY_LABEL_CHAR_PX) + KEY_ENTRY_GAP;
    }
  });

  const labels = rows.flat().map((item) => item.label);
  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${short(width)} ${short(height)}`,
      role: "img",
      "aria-label": `Sounding key: ${labels.join(", ") || "empty"}.`,
      class: "meteo-sounding meteo-sounding-key",
    },
    `\n${body.join("\n")}\n`,
  );
}
