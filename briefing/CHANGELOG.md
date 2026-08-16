# @azohra/meteo.briefing

## 0.4.1

### Patch Changes

- 6ef2985: Rework the sounding's line hierarchy and labeling. The environment traces (temperature, dew point) now draw solid at 2px and only the parcel, the one derived trace, dashes, so line style separates measurement from derivation. Labels are collision-solved deterministically: trace identities print as plain words behind a colored line-chip at the surface end and stack when traces meet; mark labels (boundary layer top, cloud base, usable lift, launch, LCL) anchor on the plot half farthest from the traces, stack a minimum gap apart when marks coincide, and carry a leader tick back to the true height when nudged. `buildSoundingKeySpec` now defaults every in-place-labeled family to self-labeled, leaving a key of at most three entries (published-level dots, the ensemble envelope when drawn, and calm when a calm level drew); `selfLabeled` and the exported `SOUNDING_SELF_LABELED` set restore the full listing. The caption under the plot uses plain words ("5 published levels · top of column 2538 m"); spec vocabulary survives only in the accessible name and the docs. The dew-point token moves to #2e8b50, validated against the light surface beside the temperature and parcel hues; gridlines recede (10° steps only, lighter, muted hPa ticks); margins tighten around a 420px default width; and the scene exposes the solved `markLabels` alongside a chip-bearing trace label shape.

## 0.4.0

### Minor Changes

- bc6dfff: New `./compare-board` subpath: one local day across a comparison's members as marks on one shared clock. `buildCompareBoardScene` places each member's thermal windows (clip flags carried), wind-ceiling exceedance spans, cap-timing span and break instant, and rain onset on an Intl-resolved local day axis as fractions plus the cited instants (bars widen by each finding's own step; the cited hours remain the authoritative values) beside launch, gust (reporting class carried), aloft, top, and storms cells, with each non-vote carrying its reason (quiet, abstained, or benched). All winds stay SI m/s. `renderCompareBoardSvg` is the minimal reference serializer, themed by the new `--meteo-board-*` token family.
- 651d8a6: The transport exports `documentPaths`, the published tree's path
  layout in one place: `manifest(model)`, `siteDocument(model, site)`,
  `history(model, site, month)`, `historyIndex(model, site, month)`, and
  the dataset-root `models()`, `sites()`, `siteContext()`, and `runs()`,
  each returning the document's root-relative path. The transport and
  history loaders now build every URL as `${baseUrl}/${documentPaths...}`
  (byte-identical to the literals they replace), and consumers
  addressing the tree where there is no URL at all (object-store keying,
  e.g. a Cloudflare R2 bucket binding) key from the same functions. The
  observation document and the catalogue's observation entries gain an
  optional `quantity` (`"downwardShortwave" | "aot"`) naming the measured
  quantity; absence means the document predates the tag, never that a
  default applies. Schema artifacts regenerated to match.
- b78200b: Add four meteogram scene options.
  
  `svgHeightPx` fits the whole chart to a known panel height: the scene
  solves the plot-panel height from its own strip-stack and label geometry
  so `scene.height` equals the target exactly, across every strip
  permutation. It takes precedence over `plotHeightPx`, as `widthPx` does
  over `columnWidthPx`, and the panel never solves below 1 px, so an
  impossible target overflows instead of inverting.
  
  `HourSampling` gains two per-hour facts consumers kept re-deriving:
  `cloudCapped` (the published usable-lift top reaches the published cloud
  base; null while the hour has no lift top, never false-by-default) and
  `capeCapped` (the CAPE strip's CIN-cap dimming; null when the model
  publishes no CAPE or no CIN — the HRDPS family carries CAPE with no CIN,
  and that absence must not read as "no cap"). Each is one computation the
  strip cells and the sampling row both consume.
  
  `verticalVelocity` gains a suppression gate. Pass the model's
  declared capabilities (`options.capabilities`, the `models.json`
  catalogue entry's object) and the field is suppressed when fewer than 3
  declared omega levels sit inside the altitude window; RDPS declares
  omega at 850 and 700 hPa only, and a high site's floor prunes the lower
  one. The scene records the suppression in `scene.suppressed`
  (`{ key, reason }`), and `buildKeySpec` never advertises a suppressed
  field because it reads only what was drawn.
  
  `launchWindows` marks each hour's surface wind against the consumer's
  launch-wind arcs (meteorological FROM bearings; arcs may wrap 360, e.g.
  `{ fromDeg: 315, toDeg: 45 }`). A judgment parameter with no default:
  omit it and nothing draws. Given arcs, `scene.windWindow` carries one
  `WindWindowMark { hourIndex, x, inWindow }` per hour, the reference
  renderer draws a thin marker row above the hour labels (filled triangle
  in, open circle out, so the states differ by shape as well as colour;
  `meteo-gram-wind-window-in`/`-out`, themed by the new
  `--meteo-gram-wind-window-*` tokens), and the key gains a `windWindow`
  entry.
- a08b8fb: New `derive` export `parcelAscent`: one virtual-temperature surface-parcel ascent — dry adiabatic to the LCL, moist pseudo-adiabatic above it — sampling buoyancy at exactly the published levels, with a TRIAL `entrainmentPerM` craft parameter (default 0, an undiluted parcel). `thermalIndexC` and `thermalIndexProfile` now ride this parcel: the sign convention is unchanged, but thermal-index values shift slightly in moist boundary layers because vapour now counts toward buoyancy, and levels above the LCL follow the moist branch instead of the dry adiabat. Dew points are additive-optional on the thermal-index entry points; omitted, the previous dry-adiabatic comparison is reproduced. New moisture helpers: `saturationVaporPressureHpa`, `mixingRatioKgKg`, `saturationMixingRatioKgKg`, `virtualTemperatureC`.
- 73968f4: Add the sounding, a second chart family behind the `./sounding` subpath: one forecast hour drawn as a flyable-band vertical profile. `buildSoundingScene(profile, { validAt })` builds a renderer-independent scene — temperature and dew-point traces with one dot per published model level and straight, visibly-interpolated segments between them; a lifted-parcel trace with its LCL; p25–p75 ensemble envelopes; horizontal marks for boundary layer top, cloud base, usable lift top, and the launch; a wind-barb ladder; and pressure secondary ticks — returning null for an instant the profile does not publish and echoing `validAt` so a Meteogram selection can drive it. `renderSoundingSvg` serializes it deterministically under the `--meteo-sounding-*` token family, `buildSoundingKeySpec`/`renderSoundingKeySvg` derive the key from what the scene drew, and `readingAtAltitude` interpolates T/Td/wind/parcel at a pointer position.

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
