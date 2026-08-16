import type { FieldNode } from "../../scene/field.js";
import type { PressureAltitudeTick } from "../../scene/types.js";

/** Overlay toggles; each overlay contributes scene elements, and the default set reproduces the reference sounding. */
export type SoundingOverlayName =
  | "temperature"
  | "dewPoint"
  | "parcel"
  | "wind"
  | "boundaryLayerTop"
  | "cloudBase"
  | "usableLiftTop"
  | "launch";

export const DEFAULT_SOUNDING_OVERLAYS: Readonly<Record<SoundingOverlayName, boolean>> = {
  temperature: true,
  dewPoint: true,
  parcel: true,
  wind: true,
  boundaryLayerTop: true,
  cloudBase: true,
  usableLiftTop: true,
  launch: true,
};

export type SoundingOverlays = Record<SoundingOverlayName, boolean>;

export interface SoundingSceneOptions {
  /** Selects the hour by instant; an instant the profile does not publish builds null — never an exception. */
  validAt: string;
  /** The launch to draw — a render input, not a document field; absent, no launch mark draws. */
  launch?: { elevationM: number } | null;
  /** Total SVG width in px. Default 480. */
  widthPx?: number;
  /** Total SVG height in px. Default 560. */
  heightPx?: number;
  /** Altitude-domain floor, metres MSL; default the model elevation, exactly as the Meteogram's. */
  floorM?: number;
  /** Altitude-domain top, metres MSL; default derives from the whole profile plus the launch by the Meteogram's domain rules, so the axis matches a Meteogram of the same profile and stays put across hours. */
  topM?: number;
  overlays?: Partial<SoundingOverlays>;
}

export interface SoundingScales {
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  /** Altitude domain: floor (model elevation) to padded column top, metres. */
  floorM: number;
  topM: number;
  /** Temperature domain across every drawn trace and envelope, degC. */
  temperatureMinC: number;
  temperatureMaxC: number;
  /** Centre x of the wind-barb ladder in the right margin. */
  barbX: number;
}

export interface SoundingAltitudeTick {
  altitudeM: number;
  y: number;
  labelMetres: string;
  labelFeet: string;
}

export interface SoundingTemperatureTick {
  temperatureC: number;
  x: number;
  label: string;
}

/** One published sample on a trace — the dot sparse honesty requires. */
export interface SoundingTraceSample {
  altitudeM: number;
  valueC: number;
  x: number;
  y: number;
  /** True for the surface (screen-level) sample at the plot floor. */
  surface: boolean;
}

export interface SoundingTrace {
  key: "temperature" | "dewPoint" | "parcel";
  className: string;
  /**
   * The samples the model published (plus the surface), ascending.
   * Renderers draw each as a dot classed `${className}-dot` — except on
   * the parcel trace, whose points are a derivation, not published levels.
   */
  samples: ReadonlyArray<SoundingTraceSample>;
  /** Straight segments joining the samples: visible interpolation — never a curve, nothing here smooths. Environment traces draw solid; only the parcel (a derivation) dashes. */
  segmentPath: string;
  /** p25-p75 envelope polygon where the level values are ensemble; null otherwise. */
  bandPath: string | null;
  dash: string | null;
  strokeWidth: number;
  /**
   * The trace's identity label — a plain word set in ink with a short
   * line-chip in the trace's colour before it, placed at the surface end
   * where the traces separate widest and collision-solved onto rows so
   * coincident surface points stack instead of overprinting.
   */
  label: {
    x: number;
    y: number;
    text: string;
    anchor: "start" | "middle" | "end";
    /** The colored line-chip before the word — the chip wears the trace hue; the text wears ink. */
    chip: { x1: number; x2: number; y: number };
  };
}

/** A horizontal altitude mark: a derived height or the launch. */
export interface SoundingMark {
  key: "boundaryLayerTop" | "cloudBase" | "usableLiftTop" | "launch";
  className: string;
  y: number;
  altitudeM: number;
  label: string;
  dash: string | null;
  /** p25-p75 spread where the source value is an ensemble; null otherwise. */
  band: { yLow: number; yHigh: number } | null;
}

/** One rung of the wind ladder; every published level draws — no thinning. */
export interface SoundingBarb {
  y: number;
  altitudeM: number;
  directionDeg: number;
  speedKmh: number;
  calm: boolean;
  shaftPath: string;
  pennantPaths: ReadonlyArray<string>;
  /** True for the surface (10 m) wind. */
  surface: boolean;
}

/** The parcel's lifting condensation level, when it sits inside the drawn band. */
export interface SoundingLclMark {
  x: number;
  y: number;
  altitudeM: number;
  label: string;
}

/**
 * One collision-solved altitude-mark label (the marks plus the LCL). Text
 * is set in ink; only the mark's own line wears its hue. Each label
 * anchors on the half of the plot farthest from the traces at its
 * altitude, and a label nudged off its true y carries a leader tick back.
 */
export interface SoundingMarkLabel {
  key: SoundingMark["key"] | "lcl";
  /** The owning mark's class — it colours the leader tick, never the text. */
  className: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  /** The mark's own y — where the label would sit unnudged. */
  trueY: number;
  /** Tick from the solved label back to the true y; null when the label sits within the nudge threshold. */
  leader: { x: number; y1: number; y2: number } | null;
}

/** Vertical node stacks hit-testing interpolates against. */
export interface SoundingSampling {
  temperatureC: ReadonlyArray<FieldNode>;
  dewPointC: ReadonlyArray<FieldNode>;
  windU: ReadonlyArray<FieldNode>;
  windV: ReadonlyArray<FieldNode>;
  parcelTempC: ReadonlyArray<FieldNode>;
  buoyancyC: ReadonlyArray<FieldNode>;
}

export interface SoundingScene {
  width: number;
  height: number;
  ariaLabel: string;
  /** The hour drawn — echoes `options.validAt`, so a Meteogram selection can drive the build and nothing public is index-keyed. */
  validAt: string;
  scales: SoundingScales;
  axes: {
    altitude: ReadonlyArray<SoundingAltitudeTick>;
    /** Median published height per isobaric level across the profile (null pressure = model elevation row) — the Meteogram's PressureAltitudeTick, reused. */
    pressureAltitude: ReadonlyArray<PressureAltitudeTick>;
    temperature: ReadonlyArray<SoundingTemperatureTick>;
  };
  traces: ReadonlyArray<SoundingTrace>;
  marks: ReadonlyArray<SoundingMark>;
  /** The marks' and LCL's labels, collision-solved — renderers print these, never the marks' raw text. */
  markLabels: ReadonlyArray<SoundingMarkLabel>;
  barbs: ReadonlyArray<SoundingBarb>;
  lcl: SoundingLclMark | null;
  /** Published levels inside the domain this hour — the count a reader can take off the dots. */
  levelCount: number;
  /** The plain-words honesty line printed under the plot: how many levels the model published and where the column ends. */
  capNote: string;
  sampling: SoundingSampling;
}

/** What `readingAtAltitude` reports for a plot y. */
export interface SoundingReading {
  validAt: string;
  altitudeM: number;
  temperatureC: number | null;
  dewPointC: number | null;
  dewPointDepressionC: number | null;
  windSpeedMps: number | null;
  windDirectionDeg: number | null;
  parcelTempC: number | null;
  /** Parcel-minus-environment virtual temperature at this altitude, degC. */
  buoyancyC: number | null;
}
