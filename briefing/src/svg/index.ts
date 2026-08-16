import type { BarbPlacement, MeteogramScene } from "../scene/types.js";
import type { KeySpec } from "../scene/key.js";
import { short } from "../scene/path.js";
import { DEFAULT_STYLESHEET } from "./theme.js";

export {
  DEFAULT_STYLESHEET,
  FIELD_STYLE_DEFAULTS,
  SERIES_TOKENS,
  STABILITY_TOKEN_DEFAULTS,
  TOKEN_DEFAULTS,
} from "./theme.js";

export interface RenderMeteogramSvgOptions {
  /** Stylesheet embedded in a <style> block; defaults to DEFAULT_STYLESHEET, and null omits it. */
  stylesheet?: string | null;
  /** Prefix for generated element ids — give each Meteogram on a page its own so pattern ids cannot collide. Default "meteo-gram". */
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

function stripScaleLabel(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBarb(barb: BarbPlacement): string {
  if (barb.calm) {
    const shared = {
      cx: short(barb.x),
      cy: short(barb.y),
      r: short(3.6 * barb.scale),
      fill: "none",
    };
    return [
      el("circle", { ...shared, class: "meteo-gram-barb-halo", "stroke-width": 2.4 }),
      el("circle", { ...shared, class: "meteo-gram-barb", "stroke-width": 1.1 }),
    ].join("");
  }
  const parts: string[] = [];
  parts.push(
    el("path", {
      d: barb.shaftPath,
      class: "meteo-gram-barb-halo",
      "stroke-width": 2.6,
      fill: "none",
      "stroke-linecap": "round",
    }),
  );
  for (const pennant of barb.pennantPaths) {
    parts.push(el("path", { d: pennant, class: "meteo-gram-barb-fill-halo", "stroke-width": 1 }));
  }
  parts.push(
    el("path", {
      d: barb.shaftPath,
      class: "meteo-gram-barb",
      "stroke-width": 1.3,
      fill: "none",
      "stroke-linecap": "round",
    }),
  );
  for (const pennant of barb.pennantPaths) {
    parts.push(el("path", { d: pennant, class: "meteo-gram-barb-fill", "stroke-width": 1 }));
  }
  return el(
    "g",
    {
      transform: `translate(${short(barb.x)} ${short(barb.y)}) rotate(${short(barb.directionDeg)}) scale(${barb.scale})`,
    },
    parts.join(""),
  );
}

/** Serializes a scene graph to a self-contained SVG document string. */
export function renderMeteogramSvg(
  scene: MeteogramScene,
  options: RenderMeteogramSvgOptions = {},
): string {
  const idPrefix = options.idPrefix ?? "meteo-gram";
  const stylesheet = options.stylesheet === undefined ? DEFAULT_STYLESHEET : options.stylesheet;
  const { plotLeft, plotTop, plotWidth, plotHeight, columnWidth } = scene.scales;
  const plotBottom = plotTop + plotHeight;
  const body: string[] = [];

  if (stylesheet) body.push(el("style", {}, `\n${stylesheet}\n`));

  const hatchId = `${idPrefix}-cloud-hatch`;
  body.push(
    el(
      "defs",
      {},
      el(
        "pattern",
        {
          id: hatchId,
          width: 7,
          height: 7,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(45)",
        },
        el("line", {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 7,
          class: "meteo-gram-cloud-hatch-line",
          "stroke-width": 1.2,
        }),
      ),
    ),
  );

  if (scene.stripDivider) {
    body.push(
      el("line", {
        x1: plotLeft,
        y1: short(scene.stripDivider.y),
        x2: plotLeft + plotWidth,
        y2: short(scene.stripDivider.y),
        class: "meteo-gram-strip-divider",
      }),
      text(
        {
          x: plotLeft + plotWidth,
          y: short(scene.stripDivider.y - 3),
          "text-anchor": "end",
          class: "meteo-gram-strip-divider-label",
        },
        scene.stripDivider.label,
      ),
    );
  }

  for (const strip of scene.strips) {
    body.push(
      el("rect", {
        x: plotLeft,
        y: strip.top,
        width: plotWidth,
        height: strip.height,
        class: "meteo-gram-strip-frame",
        "stroke-width": 0.7,
      }),
      el("line", {
        x1: plotLeft,
        y1: short(strip.top + strip.height / 2),
        x2: plotLeft + plotWidth,
        y2: short(strip.top + strip.height / 2),
        class: "meteo-gram-gridline",
        "stroke-width": 0.6,
        "stroke-dasharray": "2 4",
        opacity: 0.45,
      }),
    );
    if (strip.measuredToX !== undefined) {
      body.push(
        el("rect", {
          x: short(strip.measuredToX),
          y: strip.top,
          width: short(plotLeft + plotWidth - strip.measuredToX),
          height: strip.height,
          class: "meteo-gram-strip-pending",
        }),
      );
    }
    for (const cell of strip.cells ?? []) {
      if (!cell) continue;
      const attrs: Record<string, AttrValue> = {
        x: short(cell.x),
        y: strip.top,
        width: short(cell.width),
        height: strip.height,
        class: cell.className,
      };
      if (cell.opacity !== undefined) attrs["opacity"] = short(cell.opacity);
      body.push(el("rect", attrs));
    }
    for (const row of strip.rows ?? []) {
      for (const cell of row.cells) {
        if (!cell) continue;
        const attrs: Record<string, AttrValue> = {
          x: short(cell.x),
          y: short(row.top),
          width: short(cell.width),
          height: short(row.height),
          class: cell.className,
        };
        if (cell.opacity !== undefined) attrs["opacity"] = short(cell.opacity);
        body.push(el("rect", attrs));
      }
      body.push(
        text(
          {
            x: plotLeft + plotWidth + 8,
            y: short(row.top + row.height / 2 + 2.5),
            class: "meteo-gram-strip-row-label meteo-gram-mono",
          },
          row.label,
        ),
      );
    }
    if (strip.bandPath) {
      body.push(el("path", { d: strip.bandPath, class: `${strip.className}-band` }));
    }
    if (strip.areaPath) {
      body.push(el("path", { d: strip.areaPath, class: `${strip.className}-area`, opacity: 0.3 }));
    }
    if (strip.linePath) {
      body.push(
        el("path", {
          d: strip.linePath,
          class: strip.className,
          fill: "none",
          "stroke-width": 1.7,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      );
    }
    for (const dot of strip.dots ?? []) {
      body.push(
        el("circle", {
          cx: short(dot.x),
          cy: short(dot.y),
          r: 1.8,
          class: `${strip.className}-dot`,
        }),
      );
    }
    for (const dot of strip.degradedDots ?? []) {
      body.push(
        el("circle", {
          cx: short(dot.x),
          cy: short(dot.y),
          r: 1.8,
          class: `${strip.className}-degraded-dot`,
        }),
      );
    }
    body.push(
      text(
        {
          x: plotLeft - 8,
          y: strip.top + 11,
          "text-anchor": "end",
          class: "meteo-gram-strip-name",
        },
        strip.label,
      ),
      text(
        {
          x: plotLeft - 8,
          y: strip.top + 22,
          "text-anchor": "end",
          class: "meteo-gram-strip-unit",
        },
        strip.unit,
      ),
    );
    if (strip.sourceLabel) {
      body.push(
        text(
          { x: plotLeft + 6, y: strip.top + 9, class: "meteo-gram-strip-source" },
          strip.sourceLabel,
        ),
      );
    }
    if (!strip.rows) {
      body.push(
        text(
          {
            x: plotLeft + plotWidth + 8,
            y: strip.top + 8,
            class: "meteo-gram-strip-scale meteo-gram-mono",
          },
          stripScaleLabel(strip.maximum),
        ),
        text(
          {
            x: plotLeft + plotWidth + 8,
            y: strip.top + strip.height,
            class: "meteo-gram-strip-scale meteo-gram-mono",
          },
          stripScaleLabel(strip.minimum),
        ),
      );
    }
  }

  body.push(
    el("rect", {
      x: plotLeft,
      y: plotTop,
      width: plotWidth,
      height: plotHeight,
      class: "meteo-gram-frame",
    }),
  );
  for (const layer of scene.fields) {
    for (const { className, path } of layer.paths) {
      const attrs: Record<string, AttrValue> = {
        d: path,
        class: className,
        "fill-rule": "evenodd",
      };
      if (className === "meteo-gram-cloud-dense") attrs["fill"] = `url(#${hatchId})`;
      body.push(el("path", attrs));
    }
  }
  if (scene.scales.hourCount > 0 && scene.highlightSelectedHour) {
    const { stripTop } = scene.scales;
    const selectedLeft = plotLeft + scene.selectedHourIndex * columnWidth;
    const selectedCenter = short(selectedLeft + columnWidth / 2);
    body.push(
      el("rect", {
        x: short(selectedLeft),
        y: stripTop,
        width: columnWidth,
        height: plotBottom - stripTop,
        class: "meteo-gram-selected-column",
      }),
      el("line", {
        x1: selectedCenter,
        x2: selectedCenter,
        y1: stripTop,
        y2: plotBottom,
        class: "meteo-gram-selected-line",
        "stroke-width": 1,
        "stroke-dasharray": "3 4",
      }),
    );
  }
  if (scene.selection) {
    const centre = short(scene.selection.centerX);
    body.push(
      el("rect", {
        x: short(scene.selection.x),
        y: short(scene.selection.top),
        width: short(scene.selection.width),
        height: short(scene.selection.bottom - scene.selection.top),
        class: "meteo-gram-selection-column",
      }),
      el("line", {
        x1: centre,
        x2: centre,
        y1: short(scene.selection.top),
        y2: short(scene.selection.bottom),
        class: "meteo-gram-selection-line",
        "stroke-width": 1.2,
        "stroke-dasharray": "3 4",
      }),
    );
  }

  for (const tick of scene.axes.altitude) {
    body.push(
      el("line", {
        x1: plotLeft,
        y1: short(tick.y),
        x2: plotLeft + plotWidth,
        y2: short(tick.y),
        class: "meteo-gram-gridline",
        "stroke-width": 1,
      }),
      text(
        { x: plotLeft - 8, y: short(tick.y + 3), "text-anchor": "end", class: "meteo-gram-tick" },
        tick.labelMetres,
      ),
      text(
        { x: plotLeft + plotWidth + 8, y: short(tick.y + 3), class: "meteo-gram-tick" },
        tick.labelFeet,
      ),
    );
  }
  for (const tick of scene.axes.hours) {
    if (tick.gridline) {
      body.push(
        el("line", {
          x1: short(tick.x),
          x2: short(tick.x),
          y1: plotTop,
          y2: plotBottom,
          class: "meteo-gram-hourline",
          "stroke-width": 0.6,
          opacity: 0.15,
        }),
      );
    }
    body.push(
      text(
        {
          x: short(tick.x),
          y: plotBottom + 18,
          "text-anchor": "middle",
          class: "meteo-gram-hour-tick meteo-gram-mono",
        },
        tick.label,
      ),
    );
  }
  for (const mark of scene.surfaceTemperatures) {
    body.push(
      text(
        {
          x: short(mark.x),
          y: short(mark.y),
          "text-anchor": "middle",
          class: "meteo-gram-surface-temp meteo-gram-mono",
        },
        mark.label,
      ),
    );
  }

  if (scene.launch) {
    body.push(
      el("line", {
        x1: plotLeft,
        x2: plotLeft + plotWidth,
        y1: short(scene.launch.y),
        y2: short(scene.launch.y),
        class: "meteo-gram-launch-line",
        "stroke-width": 1,
        "stroke-dasharray": "2 4",
        opacity: 0.68,
      }),
      text(
        {
          x: plotLeft + 7,
          y: short(scene.launch.y - 6),
          class: "meteo-gram-launch-label meteo-gram-haloed-text",
          "stroke-width": 2.5,
        },
        scene.launch.label,
      ),
    );
  }

  for (const entry of scene.series) {
    if (entry.bandPath) {
      body.push(el("path", { d: entry.bandPath, class: `${entry.className.split(" ")[0]}-band` }));
    }
  }
  for (const entry of scene.series) {
    if (!entry.path) continue;
    const halo: Record<string, AttrValue> = {
      d: entry.path,
      class: "meteo-gram-halo",
      fill: "none",
      "stroke-width": short(entry.strokeWidth + 1.8),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    const main: Record<string, AttrValue> = {
      d: entry.path,
      class: entry.className,
      fill: "none",
      "stroke-width": entry.strokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    if (entry.dash) {
      halo["stroke-dasharray"] = entry.dash;
      main["stroke-dasharray"] = entry.dash;
    }
    body.push(el("path", halo), el("path", main));
  }

  for (const marker of scene.markers) {
    body.push(
      el(
        "g",
        { transform: `translate(${short(marker.x)} ${short(marker.y)})` },
        el("path", { d: marker.path, class: "meteo-gram-marker-halo", "stroke-width": 2.4 }) +
          el("path", {
            d: marker.path,
            class: marker.kind === "wing" ? "meteo-gram-marker-wing" : "meteo-gram-marker-cloud",
            "stroke-width": 0.6,
          }),
      ),
    );
  }
  for (const barb of scene.barbs) body.push(renderBarb(barb));
  if (scene.selection?.barb) {
    const ringed = scene.selection.barb;
    body.push(
      el("circle", {
        cx: short(ringed.x),
        cy: short(ringed.y),
        r: short(12 * ringed.scale),
        class: "meteo-gram-selection-ring",
        fill: "none",
        "stroke-width": 1.4,
      }),
    );
  }
  for (const gust of scene.gusts) {
    body.push(
      text(
        {
          x: short(gust.x),
          y: short(gust.y),
          "text-anchor": "middle",
          class: "meteo-gram-gust meteo-gram-haloed-text meteo-gram-mono",
          "stroke-width": 2.2,
        },
        gust.label,
      ),
    );
  }
  for (const label of scene.labels) {
    body.push(
      text(
        {
          x: short(label.x),
          y: short(label.y),
          "text-anchor": label.anchor,
          class: `${label.className} meteo-gram-series-label meteo-gram-haloed-text`,
          "stroke-width": 2.5,
        },
        label.text,
      ),
    );
  }

  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${short(scene.width)} ${short(scene.height)}`,
      role: "img",
      "aria-label": scene.ariaLabel,
      class: "meteo-gram",
    },
    `\n${body.join("\n")}\n`,
  );
}

const KEY_PAD = 12;
const KEY_LABEL_CHAR_PX = 5.8;
const KEY_TITLE_CHAR_PX = 6.3;
const KEY_GROUP_CHAR_PX = 4.9;
const KEY_SWATCH_W = 26;
const KEY_CHIP_W = 24;
const KEY_CHIP_H = 9;
const KEY_RAMP_CELL_W = 9;
const KEY_SWATCH_STROKE = 2;
const KEY_LABEL_GAP = 6;
const KEY_ENTRY_GAP = 18;
const KEY_ROW_H = 26;
const KEY_TITLE_GAP = 10;
const KEY_MIN_CELL_W = 40;
const KEY_BAR_H = 22;

/**
 * Serializes a key spec (scene/buildKeySpec) to a self-contained SVG
 * string — the reference key; swatches draw with each entry's real dash,
 * stroke width and class, so the tokens theme the key exactly as they
 * theme the chart. Default `idPrefix` is "meteo-gram-key".
 */
export function renderKeySvg(spec: KeySpec, options: RenderMeteogramSvgOptions = {}): string {
  const idPrefix = options.idPrefix ?? "meteo-gram-key";
  const stylesheet = options.stylesheet === undefined ? DEFAULT_STYLESHEET : options.stylesheet;

  type RowItem =
    | { kind: "series"; label: string; className: string; dash: string | null }
    | { kind: "hatch"; label: string }
    | { kind: "band"; label: string }
    | { kind: "smokeHaze"; label: string }
    | { kind: "measuredDimming"; label: string }
    | { kind: "note"; label: string }
    | { kind: "ramp"; label: string; classes: ReadonlyArray<string> };
  const items: RowItem[] = [
    ...spec.series.map((entry) => ({
      kind: "series" as const,
      label: entry.label,
      className: entry.className,
      dash: entry.dash,
    })),
    ...(spec.hatch ? [{ kind: "hatch" as const, label: spec.hatch.label }] : []),
    ...(spec.band ? [{ kind: "band" as const, label: spec.band.label }] : []),
    ...(spec.smokeHaze ? [{ kind: "smokeHaze" as const, label: spec.smokeHaze.label }] : []),
    ...(spec.measuredDimming
      ? [{ kind: "measuredDimming" as const, label: spec.measuredDimming.label }]
      : []),
    ...spec.ramps.map((entry) => ({
      kind: "ramp" as const,
      label: entry.label,
      classes: entry.classes,
    })),
    ...(spec.smokeAdjusted ? [{ kind: "note" as const, label: spec.smokeAdjusted.label }] : []),
  ];
  const itemSwatchWidth = (item: RowItem) =>
    item.kind === "series"
      ? KEY_SWATCH_W
      : item.kind === "ramp"
        ? item.classes.length * KEY_RAMP_CELL_W
        : item.kind === "note"
          ? 0
          : KEY_CHIP_W;
  const itemWidth = (item: RowItem) =>
    itemSwatchWidth(item) + KEY_LABEL_GAP + Math.ceil(item.label.length * KEY_LABEL_CHAR_PX);
  const rowWidth =
    items.reduce((sum, item) => sum + itemWidth(item), 0) +
    KEY_ENTRY_GAP * Math.max(items.length - 1, 0);
  const title = spec.stability?.title ?? "";
  const titleWidth = spec.stability
    ? Math.ceil(title.length * KEY_TITLE_CHAR_PX) + KEY_TITLE_GAP
    : 0;
  const minStabilityWidth = spec.stability
    ? titleWidth + KEY_MIN_CELL_W * spec.stability.classes.length
    : 0;
  const width = Math.max(rowWidth, minStabilityWidth) + 2 * KEY_PAD;
  const rowBottom = items.length > 0 ? 6 + KEY_ROW_H : 6;
  const barTop = rowBottom + 14;
  const height = spec.stability ? barTop + KEY_BAR_H + 10 : rowBottom + 6;

  const body: string[] = [];
  if (stylesheet) body.push(el("style", {}, `\n${stylesheet}\n`));
  if (spec.hatch) {
    const hatchId = `${idPrefix}-cloud-hatch`;
    body.push(
      el(
        "defs",
        {},
        el(
          "pattern",
          {
            id: hatchId,
            width: 7,
            height: 7,
            patternUnits: "userSpaceOnUse",
            patternTransform: "rotate(45)",
          },
          el("line", {
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 7,
            class: "meteo-gram-cloud-hatch-line",
            "stroke-width": 1.2,
          }),
        ),
      ),
    );
  }

  let x = (width - rowWidth) / 2;
  const swatchY = 6 + KEY_ROW_H / 2;
  for (const item of items) {
    if (item.kind === "series") {
      const attrs: Record<string, AttrValue> = {
        d: `M${short(x)} ${short(swatchY)} H${short(x + KEY_SWATCH_W)}`,
        class: item.className,
        fill: "none",
        "stroke-width": KEY_SWATCH_STROKE,
        "stroke-linecap": "round",
      };
      if (item.dash) attrs["stroke-dasharray"] = item.dash;
      body.push(el("path", attrs));
      x += KEY_SWATCH_W;
    } else if (item.kind === "ramp") {
      const rampY = short(swatchY - KEY_CHIP_H / 2);
      item.classes.forEach((className, index) => {
        body.push(
          el("rect", {
            x: short(x + index * KEY_RAMP_CELL_W),
            y: rampY,
            width: KEY_RAMP_CELL_W,
            height: KEY_CHIP_H,
            class: className,
          }),
        );
      });
      body.push(
        el("rect", {
          x: short(x),
          y: rampY,
          width: item.classes.length * KEY_RAMP_CELL_W,
          height: KEY_CHIP_H,
          class: "meteo-gram-key-frame",
          "stroke-width": 0.7,
        }),
      );
      x += item.classes.length * KEY_RAMP_CELL_W;
    } else if (item.kind === "note") {
      // Text-only: no swatch.
    } else {
      const chipX = short(x);
      const chipY = short(swatchY - KEY_CHIP_H / 2);
      const chip: Record<string, AttrValue> = {
        x: chipX,
        y: chipY,
        width: KEY_CHIP_W,
        height: KEY_CHIP_H,
      };
      if (item.kind === "hatch") chip["fill"] = `url(#${idPrefix}-cloud-hatch)`;
      else if (item.kind === "smokeHaze") {
        chip["class"] = "meteo-gram-smoke-cell";
        chip["opacity"] = 0.5;
      } else if (item.kind === "measuredDimming") {
        chip["class"] = "meteo-gram-dim-cell";
        chip["opacity"] = 0.5;
      } else chip["class"] = "meteo-gram-key-band";
      body.push(
        el("rect", chip),
        el("rect", {
          x: chipX,
          y: chipY,
          width: KEY_CHIP_W,
          height: KEY_CHIP_H,
          class: "meteo-gram-key-frame",
          "stroke-width": 0.7,
        }),
      );
      x += KEY_CHIP_W;
    }
    x += KEY_LABEL_GAP;
    body.push(
      text({ x: short(x), y: short(swatchY + 3.5), class: "meteo-gram-key-label" }, item.label),
    );
    x += Math.ceil(item.label.length * KEY_LABEL_CHAR_PX) + KEY_ENTRY_GAP;
  }

  if (spec.stability) {
    const barX = KEY_PAD + titleWidth;
    const cellW = (width - 2 * KEY_PAD - titleWidth) / spec.stability.classes.length;
    const cells: string[] = [];
    cells.push(
      text(
        { x: KEY_PAD, y: short(barTop + KEY_BAR_H / 2 + 3), class: "meteo-gram-key-title" },
        title,
      ),
    );
    spec.stability.classes.forEach((entry, index) => {
      cells.push(
        el(
          "rect",
          {
            x: short(barX + index * cellW),
            y: short(barTop),
            width: short(cellW),
            height: KEY_BAR_H,
            class: `meteo-gram-stab-${entry.className}`,
          },
          el("title", {}, escapeXml(entry.label)),
        ),
      );
    });
    spec.stability.classes.slice(0, -1).forEach((entry, index) => {
      cells.push(
        text(
          {
            x: short(barX + (index + 1) * cellW),
            y: short(barTop - 4),
            "text-anchor": "middle",
            class: "meteo-gram-key-boundary meteo-gram-mono",
          },
          String(entry.maxLapse),
        ),
      );
    });
    let offset = 0;
    for (const group of spec.stability.groups) {
      const maxPx = group.span * cellW - 8;
      const label =
        group.label.length * KEY_GROUP_CHAR_PX <= maxPx
          ? group.label
          : `${group.label.slice(0, Math.max(1, Math.floor(maxPx / KEY_GROUP_CHAR_PX) - 1))}…`;
      cells.push(
        text(
          {
            x: short(barX + (offset + group.span / 2) * cellW),
            y: short(barTop + KEY_BAR_H / 2 + 3),
            "text-anchor": "middle",
            class: "meteo-gram-key-group",
            "stroke-width": 2,
          },
          label,
        ),
      );
      offset += group.span;
    }
    body.push(
      el(
        "g",
        {
          role: "img",
          "aria-label":
            "Lapse-rate stability ramp: very unstable at the left through strong inversion at the right; boundary values in °C per 1,000 ft",
        },
        cells.join(""),
      ),
    );
  }

  const lineItems = items.filter((item) => item.kind !== "ramp");
  const ariaParts = [
    lineItems.length > 0
      ? `line styles for ${lineItems.map((item) => item.label).join(", ")}`
      : null,
    spec.ramps.length > 0
      ? `shading ramps for ${spec.ramps.map((ramp) => ramp.label).join("; ")}`
      : null,
    spec.stability ? "and the lapse-rate stability ramp" : null,
  ].filter((part): part is string => part !== null);
  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${short(width)} ${short(height)}`,
      role: "img",
      "aria-label": `Meteogram key: ${ariaParts.join(" ") || "empty"}.`,
      class: "meteo-gram meteo-gram-key",
    },
    `\n${body.join("\n")}\n`,
  );
}
