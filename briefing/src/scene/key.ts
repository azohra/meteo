import { STABILITY_CLASSES } from "../derive/index.js";
import type { FieldLayer, MeteogramScene, SeriesElement } from "./types.js";

/** One series line in the key, carrying the real style facts. */
export interface KeySeriesEntry {
  /** Same identity as the scene.series entries it describes. */
  key: SeriesElement["key"];
  /** Label-override id: the entry's most specific class token ("meteo-gram-series-usable"). */
  id: string;
  /** Reference prose; override via KeySpecOptions.labels[id]. */
  label: string;
  /** The series' own class — tokens theme the key exactly as the chart. */
  className: string;
  /** The real dash, inherited from the scene, never restated. */
  dash: string | null;
  strokeWidth: number;
}

/** One field overlay's colour ramp; `classes` are the classes the scene actually drew, in weak-to-strong reading order. */
export interface KeyRampEntry {
  key: FieldLayer["key"];
  /** Label-override id ("ramp-thermalIndex"). */
  id: string;
  /** Reference prose, direction included ("Thermal index, weak → strong"). */
  label: string;
  classes: ReadonlyArray<string>;
}

export interface KeyStabilityClass {
  className: string;
  /** Upper bound of the class in °C per 1000 ft (from derive/'s table). */
  maxLapse: number;
  /** Plain words — each cell's tooltip / accessible name. */
  label: string;
}

/** A group word printed across `span` adjacent stability cells. */
export interface KeyStabilityGroup {
  id: string;
  label: string;
  span: number;
}

export interface KeySpec {
  /** Keyed lines in the reference reading order; lines that label themselves on the plot stay out of the key. */
  series: ReadonlyArray<KeySeriesEntry>;
  /** Field-overlay ramps for what this scene shaded, in the reference order. */
  ramps: ReadonlyArray<KeyRampEntry>;
  /** The condensation hatch chip; null when the clouds overlay drew none. */
  hatch: { id: string; label: string } | null;
  /** The eight-class lapse ramp; null when the stability field is absent. */
  stability: {
    title: string;
    classes: ReadonlyArray<KeyStabilityClass>;
    groups: ReadonlyArray<KeyStabilityGroup>;
  } | null;
  /** The p25-p75 envelope note; null unless some series carries a band. */
  band: { id: string; label: string } | null;
  /** The smoke-haze chip — one explanation covering the forecast smoke strip and the measured "AOT" strip, which tint with the same cell class on the same scale; null when no haze cells were drawn. */
  smokeHaze: { id: string; label: string } | null;
  /** The smoke-adjusted view's label, present exactly when the scene is the adjusted view — rendering it is how a reference-key consumer satisfies the must-label rule. */
  smokeAdjusted: { id: string; label: string } | null;
  /** The measured-dimming chip; null when no dimming cells were drawn. */
  measuredDimming: { id: string; label: string } | null;
}

export interface KeySpecOptions {
  /** Prose overrides keyed by entry id; the reference words are the defaults, and the style facts are not overridable — they are the scene's. */
  labels?: Readonly<Record<string, string>>;
  /** Opts a self-labeling line family into the key with its real style facts; families the scene did not draw stay out either way. */
  selfLabeled?: ReadonlyArray<"dewPointIsoline" | "isotherm">;
}

const KEY_SERIES_ORDER: ReadonlyArray<{ id: string; label: string }> = [
  { id: "meteo-gram-series-usable", label: "Usable lift" },
  { id: "meteo-gram-series-cloud-base", label: "Cloud base" },
  { id: "meteo-gram-series-boundary", label: "Boundary layer" },
  { id: "meteo-gram-series-pbl", label: "Model boundary layer" },
  { id: "meteo-gram-isotherm-freezing", label: "0 °C" },
];

const SELF_LABELED_ORDER: ReadonlyArray<{
  key: "dewPointIsoline" | "isotherm";
  id: string;
  label: string;
}> = [
  { key: "dewPointIsoline", id: "meteo-gram-dewpoint-isoline", label: "Dew point" },
  { key: "isotherm", id: "meteo-gram-isotherm", label: "Isotherms" },
];

const KEY_RAMP_ORDER: ReadonlyArray<{
  key: KeyRampEntry["key"];
  label: string;
  classOrder: ReadonlyArray<string>;
}> = [
  {
    key: "thermalIndex",
    label: "Thermal index, weak → strong",
    classOrder: [
      "meteo-gram-ti-weak",
      "meteo-gram-ti-fair",
      "meteo-gram-ti-good",
      "meteo-gram-ti-strong",
    ],
  },
  {
    key: "windShear",
    label: "Wind shear, light → strong",
    classOrder: ["meteo-gram-shear-light", "meteo-gram-shear-moderate", "meteo-gram-shear-strong"],
  },
  {
    key: "relativeHumidity",
    label: "Humidity, 60 → 95%",
    classOrder: ["meteo-gram-rh-60", "meteo-gram-rh-80", "meteo-gram-rh-95"],
  },
  {
    key: "verticalVelocity",
    label: "Vertical motion, sink → lift",
    classOrder: [
      "meteo-gram-omega-sink-strong",
      "meteo-gram-omega-sink",
      "meteo-gram-omega-lift",
      "meteo-gram-omega-lift-strong",
    ],
  },
];

const STABILITY_GROUPS: ReadonlyArray<KeyStabilityGroup> = [
  { id: "stab-group-unstable", label: "Unstable", span: 2 },
  { id: "stab-group-conditional", label: "Conditional instability", span: 3 },
  { id: "stab-group-stable", label: "Stable", span: 1 },
  { id: "stab-group-inverted", label: "Inverted", span: 2 },
];

function lastClassToken(className: string): string {
  const tokens = className.trim().split(/\s+/);
  return tokens[tokens.length - 1];
}

function plainWords(className: string): string {
  const words = className.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Derives the key facts for exactly what `scene` drew. */
export function buildKeySpec(scene: MeteogramScene, options: KeySpecOptions = {}): KeySpec {
  const labels = options.labels ?? {};
  const drawn = new Map<string, SeriesElement>();
  for (const entry of scene.series) {
    const id = lastClassToken(entry.className);
    if (!drawn.has(id)) drawn.set(id, entry);
  }
  const series: KeySeriesEntry[] = [];
  for (const { id, label } of KEY_SERIES_ORDER) {
    const entry = drawn.get(id);
    if (!entry) continue;
    series.push({
      key: entry.key,
      id,
      label: labels[id] ?? label,
      className: entry.className,
      dash: entry.dash,
      strokeWidth: entry.strokeWidth,
    });
  }
  for (const { key, id, label } of SELF_LABELED_ORDER) {
    if (!options.selfLabeled?.includes(key)) continue;
    const entry = drawn.get(id);
    if (!entry) continue;
    series.push({
      key: entry.key,
      id,
      label: labels[id] ?? label,
      className: entry.className,
      dash: entry.dash,
      strokeWidth: entry.strokeWidth,
    });
  }

  const ramps: KeyRampEntry[] = [];
  for (const { key, label, classOrder } of KEY_RAMP_ORDER) {
    const drawnClasses = new Set(
      scene.fields
        .filter((field) => field.key === key)
        .flatMap((field) => field.paths.map((path) => path.className)),
    );
    const classes = classOrder.filter((className) => drawnClasses.has(className));
    if (classes.length === 0) continue;
    const id = `ramp-${key}`;
    ramps.push({ key, id, label: labels[id] ?? label, classes });
  }

  const hasDenseCloud = scene.fields.some(
    (field) =>
      field.key === "clouds" &&
      field.paths.some((path) => path.className === "meteo-gram-cloud-dense"),
  );
  const hasStability = scene.fields.some((field) => field.key === "stability");
  const hasBand = scene.series.some((entry) => entry.bandPath !== null);
  const hasSmokeHaze = scene.strips.some(
    (strip) =>
      (strip.key === "smoke" || strip.key === "observedAot") &&
      (strip.cells ?? []).some((cell) => cell !== null),
  );
  const hasMeasuredDimming = scene.strips.some(
    (strip) =>
      strip.key === "observedIrradiance" && (strip.cells ?? []).some((cell) => cell !== null),
  );

  return {
    series,
    ramps,
    hatch: hasDenseCloud
      ? { id: "meteo-gram-cloud-dense", label: labels["meteo-gram-cloud-dense"] ?? "Condensation" }
      : null,
    stability: hasStability
      ? {
          title: labels["stability-title"] ?? "LAPSE RATE",
          classes: STABILITY_CLASSES.map((entry) => ({
            className: entry.className,
            maxLapse: entry.maxLapse,
            label: labels[`meteo-gram-stab-${entry.className}`] ?? plainWords(entry.className),
          })),
          groups: STABILITY_GROUPS.map((group) => ({
            ...group,
            label: labels[group.id] ?? group.label,
          })),
        }
      : null,
    band: hasBand ? { id: "band", label: labels["band"] ?? "p25–p75 ensemble spread" } : null,
    smokeHaze: hasSmokeHaze
      ? {
          id: "meteo-gram-smoke-cell",
          label: labels["meteo-gram-smoke-cell"] ?? "Smoke haze — tint deepens with optical depth",
        }
      : null,
    smokeAdjusted: scene.smokeAdjustment
      ? {
          id: "smoke-adjusted",
          label:
            labels["smoke-adjusted"] ??
            `Smoke-adjusted w* and lift — ${scene.smokeAdjustment.smokeModel} ${scene.smokeAdjustment.smokeRun}`,
        }
      : null,
    measuredDimming: hasMeasuredDimming
      ? {
          id: "meteo-gram-dim-cell",
          label:
            labels["meteo-gram-dim-cell"] ??
            "Measured dimming — shadow deepens as the sky under-delivers",
        }
      : null,
  };
}
