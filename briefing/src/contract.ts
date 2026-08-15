import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const SITE_FORECAST_SCHEMA_VERSION = 2;

export const SITES_SCHEMA_VERSION = 2;
export const SITE_CONTEXT_SCHEMA_VERSION = 2;

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase hyphenated slug")
  .describe("Lowercase hyphenated slug — the identity of models and sites everywhere.");

const utcInstantSchema = z.iso
  .datetime()
  .describe("UTC instant, ISO 8601 with a Z suffix; fractional seconds tolerated.");

const populatedEnsembleSchema = z.object({
  members: z
    .number()
    .int()
    .positive()
    .describe(
      "How many ensemble members contributed to this position — can be lower than run.members where members were censored (null positions are excluded, not ranked at zero).",
    ),
  p10: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
  ceiledMembers: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "How many contributing members were capped at the column ceiling rather than resolved — present only where the pipeline records censoring (boundary-layer top and usable-lift top).",
    ),
});

const ensembleDropoutSchema = z.object({
  members: z
    .literal(0)
    .describe("Zero members contributed to this position — full dropout, a published fact."),
  p10: z.null(),
  p25: z.null(),
  p50: z.null(),
  p75: z.null(),
  p90: z.null(),
  ceiledMembers: z
    .literal(0)
    .optional()
    .describe("Zero of zero contributing members were ceiling-capped."),
});

export const ensembleValueSchema = z
  .union([populatedEnsembleSchema, ensembleDropoutSchema])
  .describe(
    "Ensemble percentile object: appears in any numeric data position where deterministic models publish a plain number. members: 0 with all-null percentiles is full dropout — no member produced a value at this position.",
  );
export type EnsembleValue = z.infer<typeof ensembleValueSchema>;

export const scalarSchema = z
  .union([z.number(), ensembleValueSchema])
  .describe(
    "Scalar data position: a plain number (deterministic models) or an ensemble percentile object.",
  );
export type Scalar = number | EnsembleValue;

export function isEnsembleValue(value: Scalar): value is EnsembleValue {
  return typeof value === "object" && value !== null;
}

/** True for a full-dropout ensemble position — members: 0, every percentile null. */
export function isEnsembleDropout(value: Scalar): boolean {
  return isEnsembleValue(value) && value.members === 0;
}

export const forecastSurfaceSchema = z.object({
  /** Mean-sea-level pressure, hPa — the wire's one unit for the pressure class. */
  seaLevelPressureHpa: scalarSchema.describe(
    "Mean-sea-level pressure, hPa — the wire's one unit for the pressure class, shared with station documents' field of the same name.",
  ),
  temperatureC: scalarSchema.describe("2 m air temperature, degC."),
  dewPointC: scalarSchema.describe("2 m dew point, degC."),
  windSpeedMps: scalarSchema.describe("10 m wind speed, m/s."),
  windDirectionDeg: scalarSchema.describe(
    "10 m wind direction, meteorological convention (direction the wind comes FROM), 0-359 deg.",
  ),
  cloudCoverPercent: scalarSchema.describe("Total cloud cover, % 0-100."),
  /** Precipitation rate, mm/h; semantics differ by provider — declared in models.json capabilities.precipitation and echoed in the document's semantics.precipitation. */
  precipitationMmHr: scalarSchema.describe(
    'Precipitation rate, mm/h. SEMANTICS DIFFER BY PROVIDER — declared per model in models.json capabilities.precipitation and echoed in the document\'s top-level semantics.precipitation: "instantRate" = instantaneous rate diagnostic at validAt; "windowMeanRate" = accumulation over the step window ending at validAt divided by the window length.',
  ),
  sensibleHeatFluxWm2: scalarSchema.describe("Surface sensible heat flux, W/m2."),
  latentHeatFluxWm2: scalarSchema.describe("Surface latent heat flux, W/m2."),
  /** 10 m wind gust, m/s; semantics differ by provider — declared in models.json capabilities.gust and echoed in the document's semantics.gust, and the classes must never be pooled. Absent where the model publishes no gust. */
  windGustMps: scalarSchema
    .optional()
    .describe(
      '10 m wind gust, m/s. SEMANTICS DIFFER BY PROVIDER — declared per model in models.json capabilities.gust and echoed in the document\'s top-level semantics.gust: "hourMax" = maximum model-timestep gust over the hour ending at validAt (ECCC, the pilot\'s "gusting to"); "instant" = instantaneous diagnostic gust at validAt (NOAA). Hour-max runs ~20-30 % higher systematically. Absent where the model publishes no gust.',
    ),
  /** Surface-based CAPE, J/kg (>= 0), instantaneous; provider "not computed" sentinels are masked upstream, and absence means "not published", never zero. */
  capeJkg: scalarSchema
    .optional()
    .describe(
      'Surface-based CAPE, J/kg (>= 0), instantaneous — the parcel a surface-heated thermal actually flies. Provider "not computed" sentinels are masked upstream; absent means "not published", never zero.',
    ),
  /** Surface-based CIN, J/kg (<= 0), instantaneous; decoupled from CAPE in the capabilities, so absence must not be read as "no cap". */
  cinJkg: scalarSchema
    .optional()
    .describe(
      'Surface-based CIN, J/kg (<= 0), instantaneous. Decoupled from CAPE in the capabilities (the HRDPS family publishes CAPE with no CIN); absence must not be read as "no cap".',
    ),
  /** Model planetary-boundary-layer depth, metres AGL — add site.modelElevationM before comparing with derived.boundaryLayerTopM (MSL). */
  pblHeightM: scalarSchema
    .optional()
    .describe(
      "Model planetary-boundary-layer depth, metres ABOVE GROUND (AGL), not MSL — add site.modelElevationM before comparing with derived.boundaryLayerTopM (MSL).",
    ),
  /** Instantaneous low cloud-layer fraction, % 0-100 (NOAA models only) — an NCEP terrain-following sigma band, not a fixed altitude. */
  lowCloudPercent: scalarSchema
    .optional()
    .describe(
      "Instantaneous low cloud-layer fraction, % 0-100 (NOAA models only). NCEP's terrain-following sigma band (1.0-0.642 of surface pressure), not a fixed altitude.",
    ),
  midCloudPercent: scalarSchema
    .optional()
    .describe(
      "Instantaneous middle cloud-layer fraction, % 0-100 (NOAA models only). NCEP sigma band 0.642-0.35 of surface pressure.",
    ),
  highCloudPercent: scalarSchema
    .optional()
    .describe(
      "Instantaneous high cloud-layer fraction, % 0-100 (NOAA models only). NCEP sigma band 0.35-0.15 of surface pressure.",
    ),
});
export type ForecastSurface = z.infer<typeof forecastSurfaceSchema>;

export const forecastLevelSchema = z.object({
  /** Isobaric level pressure, hPa — the vertical coordinate. */
  pressureHpa: scalarSchema.describe(
    "Isobaric level pressure, hPa — the vertical coordinate, in the hectopascals that name isobaric levels (925, 850, …).",
  ),
  heightM: scalarSchema.describe("Geopotential height of the level, metres MSL."),
  temperatureC: scalarSchema.describe("Level temperature, degC."),
  dewPointC: scalarSchema.describe("Level dew point, degC."),
  windSpeedMps: scalarSchema.describe("Level wind speed, m/s."),
  windDirectionDeg: scalarSchema.describe(
    "Level wind direction, meteorological convention (from), 0-359 deg.",
  ),
  verticalVelocityPaS: scalarSchema
    .optional()
    .describe(
      "Vertical velocity as pressure tendency (omega), Pa/s; negative is lift. Present only on models and levels declared by models.json capabilities.verticalVelocity / verticalVelocityLevels.",
    ),
  /** Per-isobaric-level total cloud fraction, % 0-100 — present only where models.json capabilities.cloudProfile is true. */
  cloudFractionPercent: scalarSchema
    .optional()
    .describe(
      "Per-isobaric-level total cloud fraction, % 0-100. Present only where models.json capabilities.cloudProfile is true (GFS today); level-complete within a capable model, only model-sparse.",
    ),
});
export type ForecastLevel = z.infer<typeof forecastLevelSchema>;

export const forecastDerivedSchema = z.object({
  /** Parcel-derived boundary-layer top, metres MSL; null when the surface parcel is never buoyant — a real forecast of "no convective mixing", not a gap. */
  boundaryLayerTopM: scalarSchema
    .nullable()
    .describe(
      "Parcel-derived boundary-layer top, metres MSL — where a dry-adiabatically lifted surface parcel stops being warmer than the model environment, interpolated between bracketing levels. Null when the parcel is never buoyant (no positive-buoyancy depth: night, rain, hard inversions) — a real forecast, not a gap. A parcel outclimbing the whole column yields the column ceiling, not physics; ensemble documents record that censoring in ceiledMembers.",
    ),
  /** Deardorff's convective velocity scale w*, m/s — the strength scale of boundary-layer thermals; zero means "no thermals", never "unknown". */
  thermalVelocityMps: scalarSchema.describe(
    'Deardorff\'s convective velocity scale w*, m/s: cube root of (g/theta) x virtual kinematic heat flux x boundary-layer depth, from the published sensible and latent heat fluxes (latent enters via the virtual-temperature correction) and the parcel-derived depth. Zero when the virtual heat flux or depth is non-positive (night, rain) — "no thermals", never "unknown". Derivation: https://meteo.azohra.com/docs/forecast/derivation-science/.',
  ),
  /** Effective cloud base, metres MSL, always present; it can sit below boundaryLayerTopM — cloud forming inside the convective layer, not an inconsistency. */
  cloudBaseM: scalarSchema.describe(
    "Effective cloud base, metres MSL, always present. The LOWER of the surface parcel's condensation level (Bolton 1980, eq. 15) and the first level where the published column itself saturates (dew-point depression at the 0.5 degC hatch threshold, interpolated), clamped to model terrain (a saturated surface puts it at the ground). CAN sit below boundaryLayerTopM — cloud forming inside the convective layer, not an inconsistency. Derivation: https://meteo.azohra.com/docs/forecast/derivation-science/.",
  ),
  /** Usable-lift top (hcrit), metres MSL — embeds the fixed 1.0 m/s sink convention, capped by cloudBaseM, null on days too weak to beat the sink; other sink rates come from forecast/derive's parameterized usableLiftTopM. */
  usableLiftTopM: scalarSchema
    .nullable()
    .describe(
      "Usable-lift top (hcrit), metres MSL: where the STRONGEST thermal core — w* x 4 x z^(1/3) x (1 - 0.8 z), z = height / boundary-layer depth — falls back to the pilot's sink rate. EMBEDS the fixed 1.0 m/s sink convention (part of the published value). Capped by cloudBaseM; null when even the profile-maximum core cannot beat the sink (2.02 x w* < 1 m/s). Other sink rates: the parameterized usableLiftTopM in forecast/derive.",
    ),
});
export type ForecastDerived = z.infer<typeof forecastDerivedSchema>;

export const forecastSmokeSchema = z.object({
  /** Near-surface smoke mass concentration, µg/m³ — the visibility and health number. */
  surfaceUgm3: scalarSchema.describe(
    "Near-surface smoke mass concentration, µg/m³ — the visibility/health number. HRRR publishes it at 8 m above ground (MASSDEN).",
  ),
  /** Vertically integrated smoke mass, mg/m² — total smoke over the site regardless of the layer it rides in. */
  columnMgm2: scalarSchema.describe(
    "Vertically integrated smoke mass, mg/m² (column mass density) — total smoke over the site regardless of the layer it rides in.",
  ),
  /** Column aerosol optical thickness, dimensionless — the sun-dimming number and the optics input for smoke-adjusted derivations. */
  aot: scalarSchema.describe(
    "Column aerosol optical thickness, dimensionless — the sun-dimming number and the optics input for smoke-adjusted derivations. HRRRv4's only prognostic aerosol is wildfire smoke, so its AOT is effectively smoke optical depth.",
  ),
});
export type ForecastSmoke = z.infer<typeof forecastSmokeSchema>;

export const forecastHourSchema = z.object({
  validAt: utcInstantSchema.describe("Forecast valid time, UTC instant."),
  surface: forecastSurfaceSchema,
  levels: z
    .array(forecastLevelSchema)
    .describe(
      "Isobaric levels, ascending height; only levels with heightM > modelElevationM + 20. Empty for models whose capabilities.levels is false.",
    ),
  derived: forecastDerivedSchema,
  /** Prognostic wildfire smoke from the profile model's own run; absence means "not published", never clear air. */
  smoke: forecastSmokeSchema
    .optional()
    .describe(
      'Prognostic wildfire smoke from the profile model\'s own run — present only where models.json capabilities.smoke is not false. Absence means "not published", never clear air. Whether derived is already smoke-aware is declared in capabilities.smoke and echoed in semantics.smoke.',
    ),
});
export type ForecastHour = z.infer<typeof forecastHourSchema>;

export const forecastSiteSchema = z
  .object({
    id: slugSchema,
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    /** The model's own terrain elevation at the sampled grid point, metres MSL — a fact about the model's sample, not about any launch. */
    modelElevationM: z
      .number()
      .describe(
        "The model's own terrain elevation at the sampled grid point, metres MSL — the plot floor and the physics reference; a fact about the model's sample, not about any launch.",
      ),
    /** The site's IANA timezone, echoed per-profile from the sites.json catalogue; absence means the document predates the echo, never that UTC applies locally. */
    timeZone: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The site\'s IANA timezone (e.g. "America/Vancouver"), echoed per-profile from the sites.json catalogue — local time is load-bearing for reading a Meteogram. Absence means the document predates the echo, never that UTC applies locally.',
      ),
  })
  .describe(
    "Sample provenance: where the atmosphere was sampled and the model's own ground there. Launch attributes are deliberately absent — a forecast document is launch-agnostic, and the launch arrives at render time (MeteogramOptions.launch); a missing launch marker is deliberate: a baked-in one would bind a grid forecast to one launch.",
  );
export type ForecastSite = z.infer<typeof forecastSiteSchema>;

export const forecastRunSchema = z.object({
  referenceTime: utcInstantSchema.describe("Model run reference time (initialization), UTC."),
  generatedAt: utcInstantSchema.describe("When the pipeline generated this document, UTC."),
  /** Ensemble member count for the run, declared once; omitted on deterministic documents — the absence is the deterministic declaration. */
  members: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Ensemble member count for the run, declared once. OMITTED on deterministic documents — the absence is the deterministic declaration. Per-position EnsembleValue.members can be lower where members were censored.",
    ),
});
export type ForecastRun = z.infer<typeof forecastRunSchema>;

/** Per-document echo of the provider semantics models.json declares for this model; absence means the document predates the tag, never that a default applies. */
export const forecastSemanticsSchema = z
  .object({
    /** Gust semantics for `surface.windGustMps`; mirrors models.json `capabilities.gust`. */
    gust: z
      .enum(["hourMax", "instant"])
      .optional()
      .describe(
        'Gust semantics for surface.windGustMps: "hourMax" = maximum model-timestep gust over the hour ending at validAt (ECCC); "instant" = instantaneous diagnostic at validAt (NOAA). Mirrors models.json capabilities.gust.',
      ),
    /** Precipitation-rate semantics for `surface.precipitationMmHr`; mirrors models.json `capabilities.precipitation`. */
    precipitation: z
      .enum(["instantRate", "windowMeanRate"])
      .optional()
      .describe(
        'Precipitation-rate semantics for surface.precipitationMmHr: "instantRate" = instantaneous rate diagnostic at validAt; "windowMeanRate" = accumulation over the step window ending at validAt divided by the window length. Mirrors models.json capabilities.precipitation.',
      ),
    /** Smoke semantics for `hours[].smoke` — whether derived quantities are already smoke-aware ("radiativelyCoupled") or smoke-blind ("passive"); mirrors models.json `capabilities.smoke`. */
    smoke: z
      .enum(["radiativelyCoupled", "passive"])
      .optional()
      .describe(
        'Smoke semantics for hours[].smoke: "radiativelyCoupled" = the model\'s radiation is attenuated by this smoke, so fluxes and derived quantities are ALREADY smoke-aware (a downstream derate would double-count); "passive" = smoke rides along without radiative feedback, so derived quantities are smoke-blind. Mirrors models.json capabilities.smoke.',
      ),
  })
  .describe(
    "Per-document echo of the provider semantics models.json declares for this model, so a stored profile stays interpretable without the catalogue. Absence of the block or a field means the document predates the tag, never that a default applies.",
  );
export type ForecastSemantics = z.infer<typeof forecastSemanticsSchema>;

export const siteForecastSchema = z
  .object({
    schemaVersion: z.literal(SITE_FORECAST_SCHEMA_VERSION),
    model: slugSchema,
    run: forecastRunSchema,
    site: forecastSiteSchema,
    semantics: forecastSemanticsSchema.optional(),
    hours: z
      .array(forecastHourSchema)
      .describe("ALL forecast hours, chronological — day windowing is a renderer choice."),
  })
  .describe(
    "meteo by Azohra site-forecast document, published at data/<model-slug>/sites/<site-slug>.json; history lines are the same document, one per line.",
  );
export type SiteForecast = z.infer<typeof siteForecastSchema>;

export const smokeDocumentHourSchema = z.object({
  validAt: utcInstantSchema.describe("Forecast valid time, UTC instant."),
  /** Total near-surface PM2.5, µg/m³ — all sources, the air-quality number. */
  pm25Ugm3: scalarSchema.describe("Total near-surface PM2.5, µg/m³ — all sources."),
  /** Near-surface PM2.5 attributed to wildfire smoke, µg/m³ — the wildfire share of pm25Ugm3. */
  smokePlumeSurfaceUgm3: scalarSchema.describe(
    "Near-surface PM2.5 attributed to wildfire smoke, µg/m³ — the wildfire share of pm25Ugm3.",
  ),
  /**
   * Vertically integrated wildfire-smoke PM2.5, mg/m². Quarantined from any
   * derived optics: despite the provider's entire-atmosphere declaration the
   * field behaves as a shallow near-surface slab, so no AOT is ever derived
   * from it.
   */
  smokePlumeColumnMgm2: scalarSchema.describe(
    "Vertically integrated wildfire-smoke PM2.5, mg/m² — total smoke over the site regardless of the layer it rides in; the mass input for optics-based derivations.",
  ),
});
export type SmokeDocumentHour = z.infer<typeof smokeDocumentHourSchema>;

export const smokeDocumentSiteSchema = z.object({
  id: slugSchema,
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  /** The site's IANA timezone, echoed from the catalogue like the profile's. */
  timeZone: z
    .string()
    .min(1)
    .optional()
    .describe("The site's IANA timezone, echoed from the sites.json catalogue."),
});
export type SmokeDocumentSite = z.infer<typeof smokeDocumentSiteSchema>;

export const smokeDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    model: slugSchema,
    run: forecastRunSchema,
    site: smokeDocumentSiteSchema,
    hours: z
      .array(smokeDocumentHourSchema)
      .describe("ALL forecast hours, chronological — same convention as profile documents."),
  })
  .describe(
    "Per-site wildfire-smoke time series from an air-quality model (RAQDPS), published at <model-slug>/sites/<site-slug>.json — a different model than the wind-profile feeds; consumers join it to a profile by site and validAt.",
  );
export type SmokeDocument = z.infer<typeof smokeDocumentSchema>;

export function parseSmokeDocument(value: unknown): SmokeDocument | null {
  const result = smokeDocumentSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSmokeDocumentJson(text: string): SmokeDocument | null {
  return parseSmokeDocument(tryParseJson(text));
}

const observedAtSchema = utcInstantSchema.describe(
  "Observation instant, UTC — the product's own timestamp, at its native cadence.",
);

export const dsrObservationSchema = z.object({
  observedAt: observedAtSchema,
  /** Measured downward shortwave flux at the surface, W/m²; instants without a good-quality retrieval are absent — "not measured", never zero. */
  downwardShortwaveWm2: z
    .number()
    .describe(
      'Measured downward shortwave flux at the surface, W/m² (GOES-R ABI L2 DSR). Daytime product: instants without a good-quality retrieval are absent from the series — "not measured", never zero.',
    ),
});
export type DsrObservation = z.infer<typeof dsrObservationSchema>;

export const aotObservationSchema = z.object({
  observedAt: observedAtSchema,
  /** Measured aerosol optical thickness at 550 nm — the same quantity a profile's `smoke` block forecasts as `aot`; instants without an accepted retrieval are absent — "not measured", never clear air. */
  aot: z
    .number()
    .describe(
      'Measured aerosol optical thickness at 550 nm (GOES-R ABI L2 AOD, high+medium quality) — the same quantity and wavelength a profile\'s smoke block forecasts as aot. Daytime product: instants without an accepted retrieval are absent — "not measured", never clear air.',
    ),
});
export type AotObservation = z.infer<typeof aotObservationSchema>;

export const observationSchema = z.union([dsrObservationSchema, aotObservationSchema]);
export type Observation = z.infer<typeof observationSchema>;

export const observationDocumentSiteSchema = z.object({
  id: slugSchema,
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  /** The site's IANA timezone, echoed from the catalogue like the profile's. */
  timeZone: z
    .string()
    .min(1)
    .optional()
    .describe("The site's IANA timezone, echoed from the sites.json catalogue."),
});
export type ObservationDocumentSite = z.infer<typeof observationDocumentSiteSchema>;

export const observationDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    model: slugSchema,
    /** The observation window and generation instant — the observation kind's replacement for a run block. */
    observed: z
      .object({
        firstObservedAt: utcInstantSchema,
        lastObservedAt: utcInstantSchema,
        generatedAt: utcInstantSchema.describe("When the pipeline generated this document, UTC."),
      })
      .describe(
        "The observation window and generation instant — the observation kind's replacement for a run block. The window rolls; the provider's own archive is the permanent record.",
      ),
    site: observationDocumentSiteSchema,
    observations: z
      .array(observationSchema)
      .describe(
        "Chronological measured instants at product cadence. Gaps are real: an absent instant had no good-quality retrieval (night, quality flags, scan gaps).",
      ),
  })
  .describe(
    "Per-site satellite observation time series (GOES-18 ABI L2 downward shortwave today), published at <model-slug>/sites/<site-slug>.json — measurements, not forecasts; join to profile or smoke documents by instant.",
  );
export type ObservationDocument = z.infer<typeof observationDocumentSchema>;

export function parseObservationDocument(value: unknown): ObservationDocument | null {
  const result = observationDocumentSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseObservationDocumentJson(text: string): ObservationDocument | null {
  return parseObservationDocument(tryParseJson(text));
}

type NarrowScalars<T> = T extends EnsembleValue
  ? never
  : T extends ReadonlyArray<infer Element>
    ? Array<NarrowScalars<Element>>
    : T extends object
      ? { [Key in keyof T]: NarrowScalars<T[Key]> }
      : T;

/** A profile document whose every Scalar position is a plain number — what deterministic models publish; narrow to it with `isDeterministicProfile`. */
export type DeterministicSiteForecast = Omit<NarrowScalars<SiteForecast>, "run"> & {
  run: Omit<ForecastRun, "members"> & { members?: undefined };
};

/** Narrows a parsed profile to `DeterministicSiteForecast`; `run.members` absence is the deterministic declaration, so no shape scan is needed. */
export function isDeterministicProfile(
  profile: SiteForecast,
): profile is DeterministicSiteForecast {
  return profile.run.members === undefined;
}

export const forecastManifestSiteSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
});
export type ForecastManifestSite = z.infer<typeof forecastManifestSiteSchema>;

/** Build accounting: four stable core keys; every other key is transport-specific and unstable, so never build logic on it. */
export const forecastManifestStatsSchema = z
  .object({
    downloads: z.number().describe("Transport requests made during the build (stable core)."),
    downloadBytes: z.number().describe("Bytes fetched during the build (stable core)."),
    retries: z.number().describe("Requests retried during the build (stable core)."),
    durationMs: z.number().describe("Wall-clock build duration, ms (stable core)."),
  })
  .catchall(z.number())
  .describe(
    "Build accounting: the four core keys (downloads, downloadBytes, retries, durationMs) are stable contract; every other key is transport-specific and UNSTABLE — builders add, rename, and drop them freely, so never build logic on them.",
  );
export type ForecastManifestStats = z.infer<typeof forecastManifestStatsSchema>;

export const forecastManifestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    model: slugSchema,
    referenceTime: utcInstantSchema,
    generatedAt: utcInstantSchema,
    firstForecastHour: z.number().int().nonnegative(),
    lastForecastHour: z.number().int().nonnegative(),
    forecastHours: z.number().int().nonnegative(),
    memberCount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Ensemble member count; ensemble models only."),
    sites: z.array(forecastManifestSiteSchema),
    stats: forecastManifestStatsSchema,
  })
  .describe("Per-model build manifest, published at data/<model-slug>/manifest.json.");
export type ForecastManifest = z.infer<typeof forecastManifestSchema>;

export const observationManifestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    model: slugSchema,
    referenceTime: utcInstantSchema.describe(
      "The newest measured instant — equal to lastObservedAt; doubles as the freshness instant wherever manifests are compared.",
    ),
    generatedAt: utcInstantSchema,
    firstObservedAt: utcInstantSchema,
    lastObservedAt: utcInstantSchema,
    observationCount: z.number().int().nonnegative(),
    sites: z.array(forecastManifestSiteSchema),
    stats: forecastManifestStatsSchema,
  })
  .describe(
    "Per-observation-model window manifest, published at data/<model-slug>/manifest.json: the rolling window of measured instants the current site documents carry.",
  );
export type ObservationManifest = z.infer<typeof observationManifestSchema>;

export const manifestSchema = z
  .union([forecastManifestSchema, observationManifestSchema])
  .describe(
    "Per-model build manifest, published at data/<model-slug>/manifest.json. Forecast and smoke models carry the forecast-hour span (firstForecastHour, lastForecastHour, forecastHours); observation models carry the rolling observation window (firstObservedAt, lastObservedAt, observationCount).",
  );
export type Manifest = z.infer<typeof manifestSchema>;

export const modelCapabilitiesSchema = z.object({
  levels: z.boolean().describe("False -> hours[].levels is always empty for this model."),
  pressureLevels: z
    .array(z.number())
    .describe("The isobaric levels (hPa) the model publishes today."),
  /** Vertical-velocity provenance, not just presence — declared so consumers can label converted values differently from native ones. */
  verticalVelocity: z
    .union([z.enum(["omega", "fromGeometricW"]), z.literal(false)])
    .describe(
      'Vertical-velocity provenance, not just presence: "omega" = the provider\'s own published omega (Pa/s); "fromGeometricW" = converted at build from geometric w via omega ~ -rho*g*w; false = not published. Declared so consumers can label converted values differently from native ones.',
    ),
  /** The subset of `pressureLevels` (hPa) that actually carries omega; present exactly when `verticalVelocity` is not false. */
  verticalVelocityLevels: z
    .array(z.number())
    .optional()
    .describe(
      "The subset of pressureLevels (hPa) that actually carries omega — present exactly when verticalVelocity is not false. A level absent from this list never carries omega, so renderers can label the sparse coverage instead of guessing at gaps.",
    ),
  heatFluxes: z
    .boolean()
    .describe("Whether the model publishes surface sensible and latent heat fluxes."),
  /** Gust semantics, not just presence — the two semantics differ systematically, so renderers must label them differently. */
  gust: z
    .union([z.enum(["hourMax", "instant"]), z.literal(false)])
    .describe(
      'Gust semantics, not just presence: "hourMax" = max model-timestep gust over the hour ending at validAt (ECCC); "instant" = diagnostic gust at validAt (NOAA); false = no gust published. The two differ ~20-30 % systematically, so renderers must label them differently.',
    ),
  /** Precipitation-rate semantics; required — every model publishes precipitation, so unlike `gust` there is no false. */
  precipitation: z
    .enum(["instantRate", "windowMeanRate"])
    .describe(
      'Precipitation-rate semantics: "instantRate" = instantaneous rate diagnostic at validAt; "windowMeanRate" = accumulation over the step window ending at validAt divided by its length. Required — every model publishes precipitation, so unlike gust there is no false. Echoed per document in the profile\'s semantics tag.',
    ),
  cape: z.boolean().describe("Whether the model publishes surface-based CAPE (surface.capeJkg)."),
  cin: z
    .boolean()
    .describe(
      "Whether the model publishes surface-based CIN — deliberately decoupled from cape: the HRDPS family has CAPE with no CIN.",
    ),
  pblHeight: z
    .boolean()
    .describe("Whether the model publishes its own PBL depth (surface.pblHeightM, metres AGL)."),
  cloudLayers: z
    .boolean()
    .describe("Whether the model publishes low/mid/high cloud-layer fractions (NOAA sigma bands)."),
  cloudProfile: z
    .boolean()
    .describe(
      "Whether the model publishes a per-level cloud fraction (levels[].cloudFractionPercent).",
    ),
  /** Smoke semantics, not just presence — "radiativelyCoupled" means derived quantities are already smoke-aware and a downstream derate would double-count. */
  smoke: z
    .union([z.enum(["radiativelyCoupled", "passive"]), z.literal(false)])
    .describe(
      'Smoke semantics, not just presence: "radiativelyCoupled" = prognostic smoke whose radiative effect attenuates the model\'s own shortwave, so fluxes and derived thermal quantities are ALREADY smoke-aware and a downstream derate would double-count (HRRRv4: Dowell et al. 2022, doi:10.1175/WAF-D-21-0151.1); "passive" = smoke published without radiative feedback (derived quantities are smoke-blind, a derate applies); false = no smoke published. Echoed in the profile\'s semantics.smoke.',
    ),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelEntrySchema = z.object({
  slug: slugSchema,
  label: z.string().min(1).describe("The only place prose model names live."),
  provider: z.string().min(1),
  gridKm: z.number().positive(),
  stepHours: z.number().positive(),
  horizonHours: z.number().positive(),
  /** Hours between the runs this dataset publishes — freshness metadata: a run older than about twice this interval is genuinely late. */
  runIntervalHours: z
    .number()
    .positive()
    .describe(
      "Hours between the runs this dataset publishes — the model's own schedule where every run is built, or the built subset where it is not (HRRR declares 6, its published synoptic subset). Freshness metadata: a run older than about twice this interval is genuinely late. Required since 0.3.0.",
    ),
  /** Upper end of normal for this dataset's publish of a run after its referenceTime, hours; how much lateness to tolerate stays a consumer-owned threshold. */
  typicalPublicationLagHours: z
    .number()
    .positive()
    .describe(
      "Upper end of normal for THIS dataset's publish of a run after its referenceTime, hours: provider complete-availability plus pipeline overhead (≤15 min poll + build), rounded up. Judge freshness against runIntervalHours + this; thresholds stay consumer-owned. Seeded 2026-08-10 from the dated [verified] availability times in the portal's forecast-model-feeds reference; re-verify against the accumulated run archive ~September 2026.",
    ),
  /** Machine-readable retirement notice; absent for models with no announced retirement. */
  sunset: z
    .object({
      date: z.iso.date(),
      successor: slugSchema.nullable(),
    })
    .optional()
    .describe(
      "Machine-readable retirement notice: no runs expected after date (UTC calendar date); successor names the replacing catalogue slug, or null for end-of-life with no replacement. Absent when no retirement is announced.",
    ),
  kind: z.enum(["deterministic", "ensemble"]),
  experimental: z.boolean(),
  capabilities: modelCapabilitiesSchema,
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

/** A smoke-document model: profile-entry identity and cadence metadata without profile capabilities, kept out of `models` so already-deployed catalogue guards keep parsing. */
export const smokeModelEntrySchema = z.object({
  slug: slugSchema,
  label: z.string().min(1).describe("The only place prose model names live."),
  provider: z.string().min(1),
  gridKm: z.number().positive(),
  stepHours: z.number().positive(),
  horizonHours: z.number().positive(),
  runIntervalHours: z
    .number()
    .positive()
    .describe("Hours between published runs — freshness metadata, like the profile entries'."),
  typicalPublicationLagHours: z
    .number()
    .positive()
    .describe(
      "Upper end of normal for THIS dataset's publish of a run after its referenceTime, hours — semantics, 2026-08-10 forecast-model-feeds seeding, and ~September 2026 re-verification intent exactly as on the profile entries.",
    ),
  kind: z.enum(["deterministic", "ensemble"]),
  experimental: z.boolean(),
});
export type SmokeModelEntry = z.infer<typeof smokeModelEntrySchema>;

/** An observation dataset: identity and provenance metadata only — nothing has runs to lag, and `cadenceMinutes` is the freshness yardstick. */
export const observationModelEntrySchema = z.object({
  slug: slugSchema,
  label: z.string().min(1).describe("The only place prose model names live."),
  provider: z.string().min(1),
  gridKm: z
    .number()
    .positive()
    .describe("Nominal product resolution at the sites, km — not the instrument's finest."),
  cadenceMinutes: z
    .number()
    .positive()
    .describe("Native observation cadence, minutes — the freshness yardstick."),
  experimental: z.boolean(),
});
export type ObservationModelEntry = z.infer<typeof observationModelEntrySchema>;

export const modelCatalogueSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    models: z.array(modelEntrySchema),
    /** Smoke-document models — separate from `models` so pre-smoke consumers keep parsing the catalogue. */
    smokeModels: z
      .array(smokeModelEntrySchema)
      .optional()
      .describe(
        "Smoke-document models (RAQDPS today) — separate from models so pre-smoke consumers keep parsing the catalogue. Absence means the catalogue predates smoke documents.",
      ),
    /** Observation datasets — separate from `models` so pre-observation consumers keep parsing the catalogue. */
    observationModels: z
      .array(observationModelEntrySchema)
      .optional()
      .describe(
        "Observation datasets (GOES-18 DSR today) — separate from models so pre-observation consumers keep parsing the catalogue. Absence means the catalogue predates observations.",
      ),
  })
  .describe(
    "data/models.json — the hand-maintained discovery catalogue. Frontends render what a model declares instead of hardcoding model lists.",
  );
export type ModelCatalogue = z.infer<typeof modelCatalogueSchema>;

export const siteCatalogueEntrySchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    /** The site's IANA timezone — required here, the catalogue is its home; builders echo it per-profile as the optional `site.timeZone`. */
    timeZone: z
      .string()
      .min(1)
      .describe(
        'The site\'s IANA timezone (e.g. "America/Vancouver") — required; the catalogue is its home. Local time is load-bearing for reading a Meteogram, and builders echo it per-profile as the optional site.timeZone.',
      ),
  })
  .describe(
    "One catalogued site: identity and build selection only — humans author WHERE, and nothing physical. The pipeline measures WHAT at these coordinates and publishes it in site-context.json.",
  );
export type SiteCatalogueEntry = z.infer<typeof siteCatalogueEntrySchema>;

export const sitesCatalogueSchema = z
  .object({
    schemaVersion: z.literal(SITES_SCHEMA_VERSION),
    sites: z.array(siteCatalogueEntrySchema),
  })
  .describe(
    "sites.json — the hand-maintained site catalogue: every site the builders publish documents for. Identity and build selection only: humans author WHERE; the pipeline measures WHAT (site-context.json). Published to the dataset root verbatim.",
  );
export type SitesCatalogue = z.infer<typeof sitesCatalogueSchema>;

/** WorldCover class, published as a semantic name rather than the numeric code. */
export const landCoverClassSchema = z
  .enum([
    "treeCover",
    "shrubland",
    "grassland",
    "cropland",
    "builtUp",
    "bareSparse",
    "snowIce",
    "water",
    "wetland",
    "mangroves",
    "mossLichen",
  ])
  .describe(
    "Land-cover class, the ESA WorldCover taxonomy published as semantic names (10 treeCover, 20 shrubland, 30 grassland, 40 cropland, 50 builtUp, 60 bareSparse, 70 snowIce, 80 water, 90 wetland, 95 mangroves, 100 mossLichen).",
  );
export type LandCoverClass = z.infer<typeof landCoverClassSchema>;

export const siteContextSourceSchema = z
  .object({
    id: slugSchema,
    product: z.string().min(1).describe("Human-readable product name and vintage."),
    kind: z
      .enum(["surfaceModel", "bareEarthModel", "landCover"])
      .describe(
        'What the source measures: "surfaceModel" = DSM, canopy and buildings included; "bareEarthModel" = DTM, ground returns only; "landCover" = classified cover.',
      ),
    resolutionM: z.number().positive().describe("Native ground resolution, metres."),
    licence: z.string().min(1).describe('Licence name (e.g. "CC-BY 4.0", "OGL-BC").'),
    /** The attribution statement the source's licence requires — it travels with the data. */
    attribution: z
      .string()
      .min(1)
      .describe(
        "The attribution statement the source's licence requires. It travels with the data; renderers displaying this source's values display it.",
      ),
    url: z.string().min(1).describe("The source's authoritative landing page."),
  })
  .describe(
    "One upstream data source, with the licence attribution that must travel with its values.",
  );
export type SiteContextSource = z.infer<typeof siteContextSourceSchema>;

export const siteContextReliefSchema = z
  .object({
    radiusKm: z.number().positive(),
    minM: z.number().describe("Lowest terrain in the disc, metres MSL."),
    maxM: z.number().describe("Highest terrain in the disc, metres MSL."),
    /** The launch elevation's percentile rank among the disc's terrain: 100 = the local summit, 50 = mid-slope. */
    percentile: z
      .number()
      .min(0)
      .max(100)
      .describe(
        "The launch elevation's percentile rank among the disc's terrain: 100 = the local summit, 50 = mid-slope. Read radii together — high at 1 km and low at 10 km is a foothill in front of bigger terrain.",
      ),
  })
  .describe("Terrain relief within one radius of the launch.");
export type SiteContextRelief = z.infer<typeof siteContextReliefSchema>;

export const siteContextTerrainSchema = z
  .object({
    source: slugSchema.describe("The sources[] entry these values came from."),
    elevationM: z
      .number()
      .describe(
        "Terrain-model elevation at the catalogued point, metres MSL, bilinear. From a surface model this includes canopy — compare with the elevation pick before reading small differences as error (a gap over ~100 m suggests the pin hits different terrain in different sources).",
      ),
    slopeDeg: z
      .number()
      .min(0)
      .describe("Terrain slope at the launch, degrees (Horn 3×3 on the source grid)."),
    /** Compass bearing of the downslope direction, degrees 0-359; low-confidence on near-summit launches. */
    aspectDeg: z
      .number()
      .min(0)
      .max(359)
      .describe(
        "Compass bearing of the downslope direction, degrees 0-359. Low-confidence on near-summit launches (relief percentile near 100), where noise swings the bearing.",
      ),
    relief: z.array(siteContextReliefSchema).min(1).describe("Relief discs, ascending radius."),
  })
  .describe(
    "Terrain analysis from ONE consistent elevation model across every site, so numbers compare across the catalogue.",
  );
export type SiteContextTerrain = z.infer<typeof siteContextTerrainSchema>;

export const siteContextElevationSchema = z
  .object({
    source: slugSchema.describe("The sources[] entry the pick came from."),
    elevationM: z
      .number()
      .describe("The picked ground elevation at the catalogued coordinates, metres MSL, bilinear."),
  })
  .describe(
    "THE launch elevation: a measurement selection, not a computation — the pipeline samples ground observations at the catalogued coordinates and picks by explicit priority: lidarbc 1 m ground returns → mrdem30 30 m national DTM → glo30 surface model as a loud last resort (canopy included).",
  );
export type SiteContextElevation = z.infer<typeof siteContextElevationSchema>;

export const siteContextLandCoverFractionsSchema = z
  .object({
    radiusKm: z.number().positive(),
    byClass: z
      .partialRecord(landCoverClassSchema, z.number().min(0).max(1))
      .describe(
        "Fraction of the disc under each class, 0-1. Classes absent from the disc are omitted — absence means zero here (the map is wall-to-wall), unlike data absences elsewhere in the contract.",
      ),
  })
  .describe("Land-cover composition within one radius of the launch.");
export type SiteContextLandCoverFractions = z.infer<typeof siteContextLandCoverFractionsSchema>;

export const siteContextLandCoverSchema = z
  .object({
    source: slugSchema.describe("The sources[] entry these values came from."),
    atLaunch: landCoverClassSchema.describe(
      "The class of the single pixel under the launch point. One 10 m pixel is fragile — read it beside the 1 km fractions.",
    ),
    fractions: z
      .array(siteContextLandCoverFractionsSchema)
      .min(1)
      .describe("Composition discs, ascending radius."),
  })
  .describe(
    "What the ground around the launch is made of — the thermal-source character (forest holds heat back; clearcut, rock and grass release it; water kills it).",
  );
export type SiteContextLandCover = z.infer<typeof siteContextLandCoverSchema>;

export const siteContextEntrySchema = z
  .object({
    elevation: siteContextElevationSchema,
    terrain: siteContextTerrainSchema,
    landCover: siteContextLandCoverSchema,
  })
  .describe(
    "One site's measured ground truth: the elevation pick, terrain analysis, and land cover. Coordinates and timezone are NOT echoed here — sites.json is their home; join by slug.",
  );
export type SiteContextEntry = z.infer<typeof siteContextEntrySchema>;

export const siteContextSchema = z
  .object({
    schemaVersion: z.literal(SITE_CONTEXT_SCHEMA_VERSION),
    generatedAt: utcInstantSchema.describe("When the context was generated, UTC."),
    sources: z
      .array(siteContextSourceSchema)
      .min(1)
      .describe("Every upstream source any site block references, with licence attributions."),
    sites: z
      .record(slugSchema, siteContextEntrySchema)
      .describe("Site slug → context. Join against sites.json; slugs are the identity."),
  })
  .describe(
    "site-context.json — static per-site ground truth (the elevation pick, terrain, land cover), machine-measured from open data and committed beside the hand-maintained catalogues: humans author WHERE (sites.json); the pipeline measures WHAT (this file). No cadence: regenerate when the site catalogue changes.",
  );
export type SiteContext = z.infer<typeof siteContextSchema>;

export const runsIndexEntrySchema = z.object({
  referenceTime: utcInstantSchema.describe("The model's currently published run, UTC."),
  generatedAt: utcInstantSchema.describe("When that run's documents were generated, UTC."),
});
export type RunsIndexEntry = z.infer<typeof runsIndexEntrySchema>;

export const runsIndexSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runs: z
      .record(slugSchema, runsIndexEntrySchema)
      .describe("Model slug -> the manifest's (referenceTime, generatedAt) pair."),
  })
  .describe(
    "data/runs.json — the machine-written cross-model run index, keyed by model slug: per published model, its manifest's (referenceTime, generatedAt) pair, regenerated wholesale at every publish. One fetch answers \"how fresh is everything\"; judge lateness against each model's declared runIntervalHours.",
  );
export type RunsIndex = z.infer<typeof runsIndexSchema>;

export function parseSiteForecast(value: unknown): SiteForecast | null {
  const result = siteForecastSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSiteForecastJson(text: string): SiteForecast | null {
  return parseSiteForecast(tryParseJson(text));
}

export function parseForecastManifest(value: unknown): ForecastManifest | null {
  const result = forecastManifestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseForecastManifestJson(text: string): ForecastManifest | null {
  return parseForecastManifest(tryParseJson(text));
}

export function parseObservationManifest(value: unknown): ObservationManifest | null {
  const result = observationManifestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseObservationManifestJson(text: string): ObservationManifest | null {
  return parseObservationManifest(tryParseJson(text));
}

export function parseManifest(value: unknown): Manifest | null {
  const result = manifestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseManifestJson(text: string): Manifest | null {
  return parseManifest(tryParseJson(text));
}

export function parseModelCatalogue(value: unknown): ModelCatalogue | null {
  const result = modelCatalogueSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseModelCatalogueJson(text: string): ModelCatalogue | null {
  return parseModelCatalogue(tryParseJson(text));
}

export function parseSitesCatalogue(value: unknown): SitesCatalogue | null {
  const result = sitesCatalogueSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSitesCatalogueJson(text: string): SitesCatalogue | null {
  return parseSitesCatalogue(tryParseJson(text));
}

export function parseSiteContext(value: unknown): SiteContext | null {
  const result = siteContextSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSiteContextJson(text: string): SiteContext | null {
  return parseSiteContext(tryParseJson(text));
}

export function parseRunsIndex(value: unknown): RunsIndex | null {
  const result = runsIndexSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseRunsIndexJson(text: string): RunsIndex | null {
  return parseRunsIndex(tryParseJson(text));
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A stored wire document (or one hour / block of one) — untyped JSON, so migrations pass unknown fields through untouched. */
export type WireDocument = Record<string, unknown>;

/** Wire v1 -> v2 rename map for hour-level speed fields (surface and pressure levels alike). */
export const WIRE_V1_HOUR_RENAMES: Record<string, string> = {
  windSpeedMs: "windSpeedMps",
  windGustMs: "windGustMps",
};

/** Wire v1 -> v2 rename map for the derived block. */
export const WIRE_V1_DERIVED_RENAMES: Record<string, string> = {
  thermalVelocityMs: "thermalVelocityMps",
};

const scratchFloat = new DataView(new ArrayBuffer(8));

/**
 * CPython `round(value, decimals)`, exactly — the wire's one rounding
 * primitive: half-even on the decimal rendering of the double's exact
 * binary value, which no JS built-in reproduces, computed in exact BigInt
 * arithmetic.
 */
export function roundContract(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    if (decimals === 0) {
      throw new Error(`cannot round non-finite value ${value} to an integer`);
    }
    return value;
  }
  if (value === 0) {
    return decimals === 0 ? 0 : value;
  }
  scratchFloat.setFloat64(0, value);
  const hi = scratchFloat.getUint32(0);
  const lo = scratchFloat.getUint32(4);
  const negative = hi >>> 31 === 1;
  const biasedExponent = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  // |value| = m x 2^e exactly (subnormals have no implicit leading bit).
  const m = biasedExponent === 0 ? fraction : fraction | (1n << 52n);
  const e = (biasedExponent === 0 ? 1 : biasedExponent) - 1075;

  const pow10 = 10n ** BigInt(decimals);
  let n: bigint;
  if (e >= 0) {
    n = m * (1n << BigInt(e)) * pow10;
  } else {
    const denominator = 1n << BigInt(-e);
    const numerator = m * pow10;
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const doubled = remainder * 2n;
    const roundUp = doubled > denominator || (doubled === denominator && (quotient & 1n) === 1n);
    n = roundUp ? quotient + 1n : quotient;
  }

  const magnitude = Number(`${n}e-${decimals}`);
  const result = negative ? -magnitude : magnitude;
  return decimals === 0 && result === 0 ? 0 : result;
}

function renamed(block: WireDocument, renames: Record<string, string>): WireDocument {
  const out: WireDocument = {};
  for (const [key, value] of Object.entries(block)) {
    out[renames[key] ?? key] = value;
  }
  return out;
}

function paToHpa(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const out: WireDocument = {};
    for (const [key, entry] of Object.entries(value as WireDocument)) {
      out[key] =
        key.startsWith("p") && entry !== null && entry !== undefined
          ? roundContract((entry as number) / 100, 2)
          : entry;
    }
    return out;
  }
  return roundContract((value as number) / 100, 2);
}

export function migrateSurface(surface: WireDocument): WireDocument {
  const out: WireDocument = {};
  for (const [key, value] of Object.entries(surface)) {
    if (key === "pressurePa") {
      out["seaLevelPressureHpa"] = paToHpa(value);
    } else {
      out[WIRE_V1_HOUR_RENAMES[key] ?? key] = value;
    }
  }
  return out;
}

export function migrateLevel(level: WireDocument): WireDocument {
  return renamed(level, WIRE_V1_HOUR_RENAMES);
}

export function migrateHour(hour: WireDocument): WireDocument {
  const out: WireDocument = { ...hour };
  if ("surface" in out) {
    out["surface"] = migrateSurface(out["surface"] as WireDocument);
  }
  if ("levels" in out) {
    out["levels"] = (out["levels"] as WireDocument[]).map((level) => migrateLevel(level));
  }
  if ("derived" in out) {
    out["derived"] = renamed(out["derived"] as WireDocument, WIRE_V1_DERIVED_RENAMES);
  }
  if ("members" in out) {
    out["members"] = (out["members"] as WireDocument[]).map((member) => migrateHour(member));
  }
  return out;
}

function carriesPercentileBlocks(hour: WireDocument): boolean {
  const containers = [hour["surface"], hour["derived"], ...((hour["levels"] as unknown[]) ?? [])];
  return containers.some(
    (container) =>
      typeof container === "object" &&
      container !== null &&
      !Array.isArray(container) &&
      Object.values(container).some(
        (value) => typeof value === "object" && value !== null && "members" in value,
      ),
  );
}

function highestContributingMembers(hours: readonly WireDocument[]): number {
  let highest = 0;
  for (const hour of hours) {
    const containers = [hour["surface"], hour["derived"], ...((hour["levels"] as unknown[]) ?? [])];
    for (const container of containers) {
      if (typeof container !== "object" || container === null || Array.isArray(container)) {
        continue;
      }
      for (const value of Object.values(container)) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          continue;
        }
        const contributing = (value as WireDocument)["members"];
        if (typeof contributing === "number" && contributing > highest) {
          highest = contributing;
        }
      }
    }
  }
  return highest;
}

export interface MigrateDocumentOptions {
  /**
   * Member count to declare on a pre-declaration v1 ensemble document — one
   * whose hours carry percentile blocks while run.members is absent. A
   * document that already declares run.members keeps its own declaration.
   * Refused when any percentile block reports more contributing members than
   * this count: per-position members can only be lower than run.members
   * (censoring), never higher.
   */
  runMembers?: number;
}

/** A v1 profile/history document as v2; v2 input passes through unchanged so re-running a migration is safe. */
export function migrateDocument(
  document: WireDocument,
  options: MigrateDocumentOptions = {},
): WireDocument {
  const version = document["schemaVersion"];
  if (version === SITE_FORECAST_SCHEMA_VERSION) {
    return document;
  }
  if (version !== 1) {
    throw new Error(`cannot migrate schemaVersion ${JSON.stringify(version) ?? "undefined"} to v2`);
  }
  const hours = (document["hours"] as WireDocument[] | undefined) ?? [];
  const run = (document["run"] as WireDocument | null | undefined) ?? {};
  const preDeclarationEnsemble =
    !("members" in run) && hours.some((hour) => carriesPercentileBlocks(hour));
  const { runMembers } = options;
  if (preDeclarationEnsemble && runMembers === undefined) {
    throw new Error(
      "hours carry ensemble percentile blocks but run.members is absent — a " +
        "pre-declaration ensemble document; declare the run's member count " +
        "(the migrate capability's --members flag) before migrating",
    );
  }
  const out: WireDocument = { ...document };
  out["schemaVersion"] = SITE_FORECAST_SCHEMA_VERSION;
  if (preDeclarationEnsemble && runMembers !== undefined) {
    if (!Number.isInteger(runMembers) || runMembers < 1) {
      throw new Error(
        `run.members must be a positive whole count, not ${JSON.stringify(runMembers)}`,
      );
    }
    const contributing = highestContributingMembers(hours);
    if (contributing > runMembers) {
      throw new Error(
        `a percentile block reports ${contributing} contributing members, more than the ` +
          `declared ${runMembers} — the supplied member count contradicts the document`,
      );
    }
    out["run"] = { ...run, members: runMembers };
  }
  if ("hours" in out) {
    out["hours"] = (out["hours"] as WireDocument[]).map((hour) => migrateHour(hour));
  }
  return out;
}
