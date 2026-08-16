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

/** A key family the chart already labels in place; each stays out of the key unless opted back in. */
export type SoundingSelfLabeledFamily = SoundingTrace["key"] | SoundingKeyMarkEntry["key"] | "lcl";

export interface SoundingKeySpec {
  /**
   * Keyed traces in the reference reading order. Traces label themselves
   * on the plot (ink word behind a colored line-chip), so this is empty by
   * default; `selfLabeled` opts a drawn trace back in.
   */
  series: ReadonlyArray<SoundingKeySeriesEntry>;
  /** The published-level dot chip; null when no trace drew a published sample. */
  levelDot: { id: string; label: string } | null;
  /** The p25-p75 envelope note; null unless a drawn trace or mark carries a band. */
  band: { id: string; label: string } | null;
  /** The calm open-circle entry; null unless the wind ladder drew a calm level. */
  calm: { id: string; label: string } | null;
  /** Altitude marks — self-labeled on the plot, so empty by default; `selfLabeled` opts a drawn mark back in. */
  marks: ReadonlyArray<SoundingKeyMarkEntry>;
  /** The LCL marker entry — self-labeled on the plot, so null by default; `selfLabeled` opts it back in when drawn. */
  lcl: { id: string; label: string } | null;
}

export interface SoundingKeySpecOptions {
  /** Prose overrides keyed by entry id; the style facts are not overridable — they are the scene's. */
  labels?: Readonly<Record<string, string>>;
  /**
   * Opts self-labeling families back into the key with their real style
   * facts, mirroring the Meteogram key's affordance; `SOUNDING_SELF_LABELED`
   * is the complete set, for a consumer that wants the full listing.
   * Families the scene did not draw stay out either way.
   */
  selfLabeled?: ReadonlyArray<SoundingSelfLabeledFamily>;
}

/** Every self-labeling family — pass as `selfLabeled` to restore the full key listing. */
export const SOUNDING_SELF_LABELED: ReadonlyArray<SoundingSelfLabeledFamily> = [
  "temperature",
  "dewPoint",
  "parcel",
  "boundaryLayerTop",
  "cloudBase",
  "usableLiftTop",
  "launch",
  "lcl",
];

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

/**
 * Derives the key facts for exactly what `scene` drew. Everything the
 * chart labels in place — the traces, the altitude marks, the LCL — is
 * self-labeled and stays out unless `selfLabeled` opts it back in, so the
 * default key holds at most three entries: the published-level dot, the
 * ensemble envelope when one drew, and calm when a calm level drew.
 */
export function buildSoundingKeySpec(
  scene: SoundingScene,
  options: SoundingKeySpecOptions = {},
): SoundingKeySpec {
  const labels = options.labels ?? {};
  const selfLabeled = new Set(options.selfLabeled ?? []);
  const series: SoundingKeySeriesEntry[] = scene.traces
    .filter((trace) => selfLabeled.has(trace.key))
    .map((trace) => ({
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
  const hasCalm = scene.barbs.some((barb) => barb.calm);
  return {
    series,
    levelDot: hasLevelDot
      ? {
          id: "level-dot",
          label: labels["level-dot"] ?? "Model's published levels",
        }
      : null,
    band: hasBand ? { id: "band", label: labels["band"] ?? "p25–p75 ensemble spread" } : null,
    calm: hasCalm ? { id: "calm", label: labels["calm"] ?? "Calm" } : null,
    marks: scene.marks
      .filter((mark) => selfLabeled.has(mark.key))
      .map((mark) => ({
        key: mark.key,
        id: mark.className,
        label: labels[mark.className] ?? MARK_LABELS[mark.key],
        className: mark.className,
        dash: mark.dash,
      })),
    lcl:
      scene.lcl && selfLabeled.has("lcl")
        ? { id: "meteo-sounding-lcl", label: labels["meteo-sounding-lcl"] ?? "LCL" }
        : null,
  };
}
