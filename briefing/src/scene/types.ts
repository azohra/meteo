import type { ObservationDocument, SmokeDocument } from "../contract.js";
import type { FieldNode } from "./field.js";

/** Overlay toggles; each overlay contributes scene elements, and the default set reproduces the reference Meteogram. */
export type OverlayName =
  | "temperature"
  | "wind"
  | "clouds"
  | "thermalStrength"
  | "stability"
  | "thermalIndex"
  | "windShear"
  | "buoyancyShear"
  | "dewPoint"
  | "relativeHumidity"
  | "verticalVelocity"
  | "cape"
  | "gusts"
  | "pblHeight"
  | "cloudLayers"
  | "smoke"
  | "observedIrradiance"
  | "observedAot"
  | "pressure"
  | "precipitation"
  | "boundaryLayerTop"
  | "cloudBase"
  | "usableLiftTop"
  | "launch"
  | "selectedHour"
  | "surfaceTemperature";

export const DEFAULT_OVERLAYS: Readonly<Record<OverlayName, boolean>> = {
  temperature: true,
  wind: true,
  clouds: true,
  thermalStrength: true,
  stability: true,
  thermalIndex: false,
  windShear: false,
  buoyancyShear: false,
  dewPoint: false,
  relativeHumidity: false,
  verticalVelocity: false,
  cape: true,
  gusts: true,
  pblHeight: true,
  cloudLayers: true,
  smoke: true,
  observedIrradiance: true,
  observedAot: true,
  pressure: true,
  precipitation: true,
  boundaryLayerTop: true,
  cloudBase: true,
  usableLiftTop: true,
  launch: true,
  selectedHour: true,
  surfaceTemperature: true,
};

/** Class boundaries for the CAPE overdevelopment-risk strip. */
export interface CapeClassThresholds {
  /** Lower bound of the watch class, J/kg. */
  watchJkg: number;
  /** Lower bound of the risk class, J/kg. */
  riskJkg: number;
  /** Lower bound of the severe class, J/kg — also the strip's minimum axis maximum. */
  severeJkg: number;
  /** CIN (J/kg, <= 0) at or below which the hour's cell dims as capped. */
  cappedCinJkg: number;
}

/** Default renderer classes for the CAPE strip; presentation classes, not operational thresholds, replaceable via `options.capeClasses`. */
export const DEFAULT_CAPE_CLASSES: Readonly<CapeClassThresholds> = {
  watchJkg: 300,
  riskJkg: 800,
  severeJkg: 1500,
  cappedCinJkg: -50,
};

export interface MeteogramOptions {
  /** IANA timezone for hour-tick labels. */
  timeZone: string;
  /** Hours to render, by index into `profile.hours`; defaults to every hour and wins over `hours` when both are given. */
  hourIndices?: readonly number[];
  /** Hours to render: hour objects matched back to the profile by `validAt` (unmatched hours are ignored), or `{ timeZone, dateKey }` for one local calendar day. */
  hours?: ReadonlyArray<{ validAt: string }> | { timeZone: string; dateKey: string };
  overlays?: Partial<Record<OverlayName, boolean>>;
  /** The launch to draw over this render — a render input, not a document field; absent, no marker draws. */
  launch?: { name?: string; elevationM: number } | null;
  /** A smoke document for the same site, joined per hour by validAt; the profile's own smoke block wins where both exist. */
  smoke?: SmokeDocument | null;
  /** Render the smoke-adjusted alternate view (w* derated by slant-path smoke transmittance, lift envelope re-derived); no-ops with no smoke data, a smoke-aware profile, or an unchanged picture. */
  smokeAdjusted?: boolean;
  /** A site's observation document: the measured "Sun" strip draws every sample at the product's native cadence, and the hourly nearest-instant join feeds the dimming cells and pointer packets. */
  observations?: ObservationDocument | null;
  /** A site's measured-AOT observation document: the measured "AOT" strip draws every sample at the product's native cadence, and the hourly nearest-instant join feeds the haze cells and pointer packets. */
  aotObservations?: ObservationDocument | null;
  /** Largest gap between consecutive measurements the measured lines bridge, minutes; a wider gap (a retrieval outage, night) breaks the line rather than interpolating across it. TRIAL default `DEFAULT_MEASUREMENT_GAP_MINUTES` (45). */
  measurementGapMinutes?: number;
  /** 1-2-1 smoothing on the cloud-base and usable-lift series; default true. */
  smooth?: boolean;
  /** Class boundaries for the CAPE strip; defaults to `DEFAULT_CAPE_CLASSES`. */
  capeClasses?: CapeClassThresholds;
  /** Pilot sink rate (m/s): recomputes the usable-lift-top series per hour instead of reading the published value; a deliberate no-op on ensemble documents. */
  sinkRateMps?: number;
  /** Column width in px per hour. Default 44. */
  columnWidthPx?: number;
  /** Target total scene width in px; the column width is derived from it after windowing, and it wins over `columnWidthPx`. */
  widthPx?: number;
  /** Lower bound on the resolved column pitch, px; wins over a `widthPx` fit and over `maxColumnWidthPx`. */
  minColumnWidthPx?: number;
  /** Upper bound on the resolved column pitch, px. */
  maxColumnWidthPx?: number;
  /** Fit as if the window had at least this many columns; only the `widthPx` fit reads it. Default 1. */
  fitMinColumns?: number;
  /** Height of the time-height profile panel in px. Default 340. */
  plotHeightPx?: number;
  /** Hour-tick label convention: `"24h"` (default), `"12h"`, or a function of (`validAt`, display `timeZone`). */
  hourLabel?: "24h" | "12h" | ((validAt: string, timeZone: string) => string);
  /** Wind-barb hour stride; `"auto"` (default) widens only when the column pitch cannot cover the glyph footprint. */
  barbStride?: number | "auto";
  /** Minimum vertical clearance in px between barbs in one hour's column; surface and topmost barbs always draw. Default 24 × the resolved barb scale. */
  barbMinGapPx?: number;
  /** Barb glyph scale; default follows the column pitch (0.85 at 44px columns, growing to 1.0 at 66px). */
  barbScale?: number;
  /** Marker trains along the derived-height lines: a glyph every n hours, anchored on the selected hour; absent, one glyph at the selected hour. */
  markerStride?: {
    cloudBase?: number | MarkerTrainStride;
    usableLiftTop?: number | MarkerTrainStride;
  };
  /** Display-label overrides per strip key; voice only — the strip's `key` remains the identity. */
  stripLabels?: Partial<Record<MetricStrip["key"], string>>;
  /** The consumer's selection to resolve and draw: `hourIndex` clamps into the window, `altitudeM` snaps to the hour's nearest drawn barb. */
  selection?: { hourIndex: number; altitudeM?: number | null } | null;
}

export interface SceneScales {
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  columnWidth: number;
  /** The y where the metric-strip stack begins. */
  stripTop: number;
  /** Altitude domain: floor (model elevation) to padded column top, metres. */
  floorM: number;
  topM: number;
  hourCount: number;
  /** The y the surface wind barbs are placed at — half a glyph height above the plot floor, not y(floorM). */
  surfaceWindY: number;
}

export interface AltitudeTick {
  altitudeM: number;
  y: number;
  labelMetres: string;
  labelFeet: string;
}

/** Median published height per pressure level (null = model elevation row). */
export interface PressureAltitudeTick {
  altitudeM: number;
  y: number;
  pressureHpa: number | null;
}

export interface HourTick {
  index: number;
  x: number;
  label: string;
  gridline: boolean;
}

/** One classed hour cell inside a strip. */
export interface StripCell {
  x: number;
  width: number;
  className: string;
  /** Data-driven opacity (cloud-layer fraction); classed cells omit it. */
  opacity?: number;
}

/** A stacked sub-row of a strip (the cloud-layer strip's high/mid/low). */
export interface StripRow {
  /** One-letter row tag rendered at the strip's right edge ("H"/"M"/"L"). */
  label: string;
  top: number;
  height: number;
  cells: ReadonlyArray<StripCell | null>;
}

export interface MetricStrip {
  key:
    | "pressure"
    | "precipitation"
    | "cloudCover"
    | "cloudLayers"
    | "cape"
    | "thermalStrength"
    | "buoyancyShear"
    | "smoke"
    | "observedIrradiance"
    | "observedAot";
  className: string;
  label: string;
  unit: string;
  top: number;
  height: number;
  minimum: number;
  maximum: number;
  values: ReadonlyArray<number | null>;
  linePath: string;
  areaPath: string;
  /** p25-p75 envelope where the source position is an ensemble value. */
  bandPath: string | null;
  /** Lone measured samples a stroked path cannot show; renderers draw each as a small filled circle classed `${className}-dot`. */
  dots?: ReadonlyArray<{ x: number; y: number }>;
  /** Published-but-qualified measurements the strip's policy keeps off the line (a nonzero provider DQF); renderers draw each as a dimmed circle classed `${className}-degraded-dot` — indicative, never joined. */
  degradedDots?: ReadonlyArray<{ x: number; y: number }>;
  /** Measurement strips: the x of the newest measured instant. The region from here to the plot's right edge is not-yet-measured and renders as a pending tint, distinct from a data gap. Absent when measurement covers the window. */
  measuredToX?: number;
  /** Full-height classed cells drawn behind the line (CAPE risk classes). */
  cells?: ReadonlyArray<StripCell | null>;
  /** Stacked sub-rows (cloud layers); such strips draw no line. */
  rows?: ReadonlyArray<StripRow>;
  /** Whose data this strip draws; "crossModel" and "measurement" strips render below the provenance divider. */
  provenance: "model" | "crossModel" | "measurement";
  /** The inline provenance statement drawn inside the strip; absent on ordinary model strips. */
  sourceLabel?: string;
}

/** One classified field's iso-band paths, in banding order; each path must be filled with fill-rule "evenodd" to shade the area between its two threshold outlines. */
export interface FieldLayer {
  key:
    | "stability"
    | "clouds"
    | "thermalIndex"
    | "windShear"
    | "relativeHumidity"
    | "verticalVelocity";
  /** Class name -> path data, in stable class order. */
  paths: ReadonlyArray<{ className: string; path: string }>;
}

export interface SeriesElement {
  key:
    | "boundaryLayerTop"
    | "modelPblTop"
    | "cloudBase"
    | "usableLiftTop"
    | "isotherm"
    | "dewPointIsoline";
  className: string;
  path: string;
  /** p25-p75 envelope where the source position is an ensemble value. */
  bandPath: string | null;
  strokeWidth: number;
  dash: string | null;
}

export interface BarbPlacement {
  x: number;
  y: number;
  directionDeg: number;
  speedKmh: number;
  calm: boolean;
  shaftPath: string;
  pennantPaths: ReadonlyArray<string>;
  scale: number;
  /** Rendered hour index (into `hourValidAts`) the barb belongs to. */
  hourIndex: number;
  /** The wind reading's data altitude, metres MSL; the surface barb draws at `scales.surfaceWindY`, so its `y` and `yForAltitude(altitudeM)` deliberately differ. */
  altitudeM: number;
  /** True for the surface (10 m) barb — a level can sit at floor height. */
  surface: boolean;
}

/** The consumer-supplied selection resolved to scene geometry: tinted column, centre hairline, and the drawn barb the selection names. */
export interface SceneSelection {
  hourIndex: number;
  /** Column-left x; the column is `width` wide. */
  x: number;
  width: number;
  centerX: number;
  /** The strip-stack origin, matching the selected-hour highlight's span. */
  top: number;
  /** The plot floor. */
  bottom: number;
  /** The nearest drawn barb to the requested altitude; null when no altitude was named or the hour drew no barbs. */
  barb: { x: number; y: number; altitudeM: number; surface: boolean; scale: number } | null;
}

export interface SceneLabel {
  x: number;
  y: number;
  text: string;
  className: string;
  anchor: "start" | "middle" | "end";
}

export interface SceneMarker {
  kind: "wing" | "cloud";
  x: number;
  y: number;
  path: string;
  /** True on a wing whose hour also carries a cloud glyph at the same height — usable lift reached cloud base; `y` is tucked slightly below the cloud's. */
  atCloudBase?: boolean;
}

/** Per-hour gust readout drawn above the surface wind barb: "G<km/h>". */
export interface GustMark {
  x: number;
  y: number;
  speedKmh: number;
  label: string;
}

/** A marker train's step (see MeteogramOptions.markerStride). */
export interface MarkerTrainStride {
  /** Draw a glyph every this many hours along the line. */
  every: number;
}

/** Per-hour surface-temperature readout in the row under the hour labels: "<n>°". */
export interface SurfaceTemperatureMark {
  x: number;
  y: number;
  temperatureC: number;
  label: string;
}

/** Vertical node stacks per hour that hit-testing interpolates against. */
export interface HourSampling {
  validAt: string;
  temperatureC: ReadonlyArray<FieldNode>;
  dewPointC: ReadonlyArray<FieldNode>;
  lapseCPer1000Ft: ReadonlyArray<FieldNode>;
  thermalIndexC: ReadonlyArray<FieldNode>;
  relativeHumidityPercent: ReadonlyArray<FieldNode>;
  windU: ReadonlyArray<FieldNode>;
  windV: ReadonlyArray<FieldNode>;
  verticalVelocityPaS: ReadonlyArray<FieldNode>;
  /** The hour's smoke as the strip drew it (whole-column, not altitude-interpolated); null where none was drawn. */
  smoke: { surfaceUgm3: number; aot: number | null } | null;
  /** The hour's measured irradiance as the "Sun" strip drew it; transmittance is null near the horizon or when the retrieval is degraded, and `quality` is the provider's nonzero DQF (absent means best grade). */
  observation: { wm2: number; transmittance: number | null; quality?: number } | null;
  /** The hour's measured aerosol optical thickness as the "AOT" strip drew it; null where none was drawn; `quality` is the provider's nonzero DQF (absent means best grade). */
  aotObservation: { aot: number; quality?: number } | null;
}

export interface MeteogramScene {
  width: number;
  height: number;
  ariaLabel: string;
  scales: SceneScales;
  axes: {
    altitude: ReadonlyArray<AltitudeTick>;
    pressureAltitude: ReadonlyArray<PressureAltitudeTick>;
    hours: ReadonlyArray<HourTick>;
  };
  strips: ReadonlyArray<MetricStrip>;
  fields: ReadonlyArray<FieldLayer>;
  series: ReadonlyArray<SeriesElement>;
  barbs: ReadonlyArray<BarbPlacement>;
  gusts: ReadonlyArray<GustMark>;
  surfaceTemperatures: ReadonlyArray<SurfaceTemperatureMark>;
  labels: ReadonlyArray<SceneLabel>;
  markers: ReadonlyArray<SceneMarker>;
  /** The launch marker's resolved geometry; null when no launch was supplied, the overlay is off, or the elevation falls outside the altitude domain. */
  launch: { y: number; altitudeM: number; label: string } | null;
  /** Hour column highlighted as "the day's best" (max W*). */
  selectedHourIndex: number;
  /** The consumer-supplied selection resolved to geometry; null when the build supplied none. */
  selection: SceneSelection | null;
  /** The model and run the drawn smoke strip came from — possibly a cross-model join renderers must label; null when no smoke strip was drawn. */
  smokeSource: { model: string; referenceTime: string } | null;
  /** Present exactly when this scene is the smoke-adjusted alternate view; renderers must surface this label. Null on the base view, including a no-opped request. */
  smokeAdjustment: { smokeModel: string; smokeRun: string } | null;
  /** The observation dataset the measured "Sun" strip drew and its newest instant, which renderers must label; null when none was drawn. */
  observationSource: { model: string; lastObservedAt: string } | null;
  /** The AOD observation dataset the measured "AOT" strip drew and its newest instant, which renderers must label; null when none was drawn. */
  aotObservationSource: { model: string; lastObservedAt: string } | null;
  /** The provenance divider between the model's own strips and the beside-this-model zone; null when every drawn strip is the model's own. */
  stripDivider: { y: number; label: string } | null;
  /** Whether the serializer draws the selected-hour column highlight; `selectedHourIndex` stays computed either way. */
  highlightSelectedHour: boolean;
  hourValidAts: ReadonlyArray<string>;
  sampling: ReadonlyArray<HourSampling>;
}

/** What value-at-cursor hit-testing reports for a plot position. */
export interface CursorReading {
  hourIndex: number;
  validAt: string;
  altitudeM: number;
  temperatureC: number | null;
  dewPointC: number | null;
  dewPointDepressionC: number | null;
  relativeHumidityPercent: number | null;
  lapseCPer1000Ft: number | null;
  stabilityClassName: string | null;
  thermalIndexC: number | null;
  windSpeedMps: number | null;
  windDirectionDeg: number | null;
  verticalVelocityPaS: number | null;
  /** Near-surface smoke, µg/m³ — the hour's whole-column value as the smoke strip drew it; null where none was drawn. */
  smokeSurfaceUgm3: number | null;
  /** Column aerosol optical thickness for the hour; null without smoke. */
  smokeAot: number | null;
  /** Measured downward shortwave for the hour, W/m² (nearest instant, whole-column); null where none was drawn. */
  observedIrradianceWm2: number | null;
  /** The provider's DQF behind that irradiance (0 is the best grade); null where none was drawn. A nonzero grade is indicative, not quantitative — inspectors should say so. */
  observedIrradianceQuality: number | null;
  /** Measured/clear-sky transmittance for that observation; null near the horizon, for a degraded retrieval, or without one. */
  observedTransmittance: number | null;
  /** Measured aerosol optical thickness for the hour (nearest instant, whole-column); null where none was drawn. */
  observedAot: number | null;
  /** The provider's DQF behind that AOT (0 high, 1 medium); null where none was drawn. */
  observedAotQuality: number | null;
}
