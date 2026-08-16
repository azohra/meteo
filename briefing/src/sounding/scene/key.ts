import type { SoundingScene, SoundingTrace } from "./types.js";

/** One trace line in the key, carrying the real style facts from the scene. */
export interface SoundingKeySeriesEntry {
  key: SoundingTrace["key"];
  /** Label-override id: the trace's class ("meteo-sounding-temp"). */
  id: string;
  label: string;
  className: string;
  /** The real dash, inherited from the scene, never restated. */
  dash: string | null;
  strokeWidth: number;
}

/** One altitude mark in the key, carrying the real style facts. */
export interface SoundingKeyMarkEntry {
  key: "boundaryLayerTop" | "cloudBase" | "usableLiftTop" | "launch";
  id: string;
  label: string;
  className: string;
  dash: string | null;
}

export interface SoundingKeySpec {
  /** Keyed traces in the reference reading order. */
  series: ReadonlyArray<SoundingKeySeriesEntry>;
  /** The published-level dot chip; null when no trace drew a published sample. */
  levelDot: { id: string; label: string } | null;
  /** The p25-p75 envelope note; null unless a drawn trace or mark carries a band. */
  band: { id: string; label: string } | null;
  marks: ReadonlyArray<SoundingKeyMarkEntry>;
  /** The LCL marker entry; null when the scene drew none. */
  lcl: { id: string; label: string } | null;
}

export interface SoundingKeySpecOptions {
  /** Prose overrides keyed by entry id; the style facts are not overridable — they are the scene's. */
  labels?: Readonly<Record<string, string>>;
}

const SERIES_LABELS: Readonly<Record<SoundingTrace["key"], string>> = {
  temperature: "Temperature",
  dewPoint: "Dew point",
  parcel: "Lifted parcel",
};

const MARK_LABELS: Readonly<Record<SoundingKeyMarkEntry["key"], string>> = {
  boundaryLayerTop: "Boundary layer top",
  cloudBase: "Cloud base",
  usableLiftTop: "Usable lift top",
  launch: "Launch",
};

/** Derives the key facts for exactly what `scene` drew. */
export function buildSoundingKeySpec(
  scene: SoundingScene,
  options: SoundingKeySpecOptions = {},
): SoundingKeySpec {
  const labels = options.labels ?? {};
  const series: SoundingKeySeriesEntry[] = scene.traces.map((trace) => ({
    key: trace.key,
    id: trace.className,
    label: labels[trace.className] ?? SERIES_LABELS[trace.key],
    className: trace.className,
    dash: trace.dash,
    strokeWidth: trace.strokeWidth,
  }));
  const hasLevelDot = scene.traces.some(
    (trace) => trace.key !== "parcel" && trace.samples.length > 0,
  );
  const hasBand =
    scene.traces.some((trace) => trace.bandPath !== null) ||
    scene.marks.some((mark) => mark.band !== null);
  return {
    series,
    levelDot: hasLevelDot
      ? {
          id: "level-dot",
          label: labels["level-dot"] ?? "Published model level — count the dots",
        }
      : null,
    band: hasBand ? { id: "band", label: labels["band"] ?? "p25–p75 ensemble spread" } : null,
    marks: scene.marks.map((mark) => ({
      key: mark.key,
      id: mark.className,
      label: labels[mark.className] ?? MARK_LABELS[mark.key],
      className: mark.className,
      dash: mark.dash,
    })),
    lcl: scene.lcl
      ? { id: "meteo-sounding-lcl", label: labels["meteo-sounding-lcl"] ?? "LCL" }
      : null,
  };
}
