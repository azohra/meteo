# @azohra/meteo.briefing

## 0.3.0

### Minor Changes

- 7db8b23: Observation entries accept an optional `quality` — the provider's
  nonzero DQF, absent meaning the best grade — and the scene renders it
  per product's own semantics. DSR's binary DQF-1 "degraded/invalid"
  retrievals (the sunrise and sunset shoulders) never join the measured
  Sun line: they draw as dimmed dots (`MetricStrip.degradedDots`,
  classed `${className}-degraded-dot`), and they never shade the dimming
  cells, because a transmittance built on a provider-refused measurement
  would be wrong while looking plausible. AOD's medium-quality entries
  stay in the AOT line — DQF ≤ 1 is the smoke literature's validated set
  — with the grade available for stricter consumers. Pointer packets gain
  `observedIrradianceQuality` and `observedAotQuality`, and the sampling
  row's observation entries carry `quality` when nonzero. Schema
  artifacts regenerated to match.

## 0.2.0

### Minor Changes

- 0a089ca: Sunrise and sunset join the derive surface: `solarEventsForDate(dateKey,
  latitude, longitude): SolarEvents | null` — a NOAA/Meeus solar-event
  model with two-pass hour-angle refinement and the official zenith of
  90.833°, returning null through polar day and night.
  
  The date key names the solar day at that longitude (the shape
  `localDateKey` produces): correct wherever the civil date matches the
  longitudinal solar date, and a day off only where the date line
  separates the two. Event *times* are the package's; sunrise/sunset marks on a
  chart remain consumer-drawn, as the inspector recipe already prescribes.
  
  `cosSolarZenith` keeps its Spencer parameterization: the cheap bulk
  per-hour form for transmittance, where Meeus's horizon-crossing
  precision buys nothing visible.
- 4d34d0b: The measured Sun and AOT strips draw every observation at the product's
  own cadence instead of one nearest-instant sample per rendered hour.
  Three defects fall out of the old hourly join: sub-hour structure (a
  cloud shadow crossing between hour posts) was invisible, a lone
  surviving retrieval rendered as a bare SVG moveto — real data drawn as
  nothing — and the unmeasured remainder of the window was
  indistinguishable from a data gap.
  
  A measured line now stops at its data (no plot-edge extension), breaks
  across gaps wider than the new `measurementGapMinutes` option (TRIAL
  default `DEFAULT_MEASUREMENT_GAP_MINUTES`, 45 — bridges consecutive
  ten-minute granules, breaks on outages and night), and surfaces lone
  samples as dots (`MetricStrip.dots`, classed `${className}-dot`). The
  region past the newest measured instant renders as a pending tint
  (`MetricStrip.measuredToX`, class `meteo-gram-strip-pending`), so an
  in-progress day reads as filling in rather than broken. Dimming/haze
  cells, pointer packets, and the sampling row keep their hourly
  nearest-instant joins.
- 0f02bcb: Remove the v1 migration machinery. schemaVersion 1 never existed
  publicly (it was one pre-release deployment, migrated once), so the
  `meteo forecast migrate` command, `forecast/src/migrate.ts`, and the
  briefing contract's migration exports (`migrateDocument`, `migrateHour`,
  `migrateSurface`, `migrateLevel`, `WIRE_V1_HOUR_RENAMES`,
  `WIRE_V1_DERIVED_RENAMES`, `WireDocument`, `MigrateDocumentOptions`)
  served no reader and are removed. Published documents start, and have
  always started, at `schemaVersion: 2`.

### Patch Changes

- b39a15d: The AOD observation's describe strings now name the profile's `smoke`
  block as the forecast counterpart of measured `aot`. They previously said
  the smoke document forecasts `aot`; the smoke document carries no
  optical-depth field — the forecast `aot` lives in the profile's
  per-hour `smoke` block. Schema artifacts regenerated to match.

## 0.1.1

Initial release. The read side: the published-document contract, pure derivations,
typed findings, cross-model comparison, history reading, and the
Meteogram tier at `./meteogram` (scene graph and SVG serializer).
