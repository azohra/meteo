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
  /** Straight segments joining the samples: visible interpolation, token-distinct from the dots. Never a curve — nothing here smooths. */
  segmentPath: string;
  /** p25-p75 envelope polygon where the level values are ensemble; null otherwise. */
  bandPath: string | null;
  dash: string | null;
  strokeWidth: number;
  /** Short trace label beside the topmost sample; anchors differ per trace so converging traces keep separated labels. */
  label: { x: number; y: number; text: string; anchor: "start" | "middle" | "end" };
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
  barbs: ReadonlyArray<SoundingBarb>;
  lcl: SoundingLclMark | null;
  /** Published levels inside the domain this hour — the count a reader can take off the dots. */
  levelCount: number;
  /** The one-line statement of what the chart is not, printed under the plot: a flyable-band profile capped by the published column. */
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
