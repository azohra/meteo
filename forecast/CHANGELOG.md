# @azohra/meteo.forecast

## 0.6.0

### Minor Changes

- 89e07a7: The scenario-index shape becomes a zod contract owned by the forecast package (`src/scenario/contract.ts`), exported at the new `@azohra/meteo.forecast/contract` subpath. `scenarios/index.schema.json` is now emitted from that contract by `pnpm schemas` and held by a byte-compare test, the generator validates and types the index through the contract instead of ajv over a hand-written schema, and the site's scenario registry reads `scenarios/index.json` through `parseScenarioIndex()` in place of its own hand parsers. The generated `scenarios/index.json` is byte-for-byte unchanged.

### Patch Changes

- cebc9c4: The GEPS and REPS builders — twins in all but their provider facts — merge into one ECCC ensemble engine, the way the deterministic trio already shares `DatamartModel`. An `EnsembleModel` descriptor now carries each model's grid kind, wind-component convention, file naming, cadence, flux treatment, CAPE/CIN presence, and terrain encoding; the sampling, aggregation, and publication machinery exists once. Published documents, manifests, and log lines are unchanged.
- c80493a: The engine stops re-implementing shared vocabulary: dew-point depression now composes briefing's Magnus pair (`dewPointC` + `dewPointDepressionC`), `normalizeDegrees` and the dry-adiabatic lapse constant are imported from `@azohra/meteo.briefing/derive`, and the sink-rate default is no longer restated back into `usableLiftTopM`. Conversions whose published bytes pin a different floating-point spelling than core's (wind direction from components, the ensemble's circular median, terrain's radians-to-degrees) deliberately stay local, each with a comment naming the divergence. Published values are bit-identical.
- f645451: GEPS and REPS join the fences the other builders already stand behind. The already-published gate now runs for pinned runs too, so `--reference-time` of a published run skips instead of rebuilding. GEPS documents gain the `site.timeZone` echo REPS already carried, and the GEPS aggregator once again refuses a member surface missing any required scalar — only CAPE, whose −1.0 sentinel masks to absence, is optional. Both builders gain the models.json contract test that binds catalogue claims to builder configuration.
- d147363: The HRDPS West builder becomes a fourth `DatamartModel` descriptor on the shared ECCC engine instead of a near-copy of it. The descriptor carries the alpha-feed facts — URL grammar, published dew-point depression, PRATE instant-rate precipitation, per-field converts, uncapped nearest-gridpoint sampling — and the engine gained the optional fields those deltas need. Published output and log lines are unchanged.
- 9941bd3: The HRRR, GFS, NAM, and RRFS builders — four copies of the same idx-record pipeline — merge into one NOAA engine driven by a `NoaaModel` descriptor. Each model's real facts stay declarative: file grammars and completion probes, field tables with converts, smoke speciation, DPT-vs-RH level moisture, VVEL-vs-DZDT vertical velocity, Lambert rotation, and per-model precipitation algebra as small strategy closures. Published documents, manifests, and log lines are unchanged.
- afef2f7: Every run builder now hands its model-specific parts to one `publishRun` orchestrator that owns run resolution, the already-published gate, and the profile/history/manifest writes — the tail each builder previously open-coded. The Datamart wire machinery (`liveDatamartWire`, `sampleDatamartField`, the lazy J2K pool, `TASK_CONCURRENCY`) moved from the ECCC builder to `providers/datamart`, and one `transportBackoff` formula now backs every retry loop. `--max-steps` reaches all builders — GOES included — as a forwarded option; the internal `METEO_MAX_STEPS` bridge is gone. Log lines standardize on "downloads", pinned-cycle errors on one grammar. Published documents, manifests, and archives are byte-identical.
- Updated dependencies [4ffcfdc]
- Updated dependencies [c80493a]
- Updated dependencies [938b27f]
  - @azohra/meteo.briefing@0.6.2
  - @azohra/meteo.core@0.3.0
  - @azohra/meteo.grib@0.1.4

## 0.5.1

### Patch Changes

- Updated dependencies [b634597]
  - @azohra/meteo.briefing@0.6.1

## 0.5.0

### Minor Changes

- 2fddd75: Builders and `terrain` accept `--sites dataset` to read `sites.json` from the dataset root, so operators no longer keep a site catalogue in their own repository. `publish --models` uploads the packaged model catalogue. `terrain --sync` regenerates and publishes the site context when the published catalogue has moved, and is a no-op when the context is fresh. After every model upload, `publish` reads the manifest back and parses it with the reader contract's guard, so an unconsumable publication fails in the publishing job's log instead of in a consumer's ingest. `sites.json` remains the one root file the engine never writes.
- e3e5f9a: `meteo forecast terrain` writes site-context v3, where each entry records verbatim the catalogue point it measured. New `--check` flag: reports fresh or stale for the published context against the published catalogue, read through the dataset path. Stale covers everything regenerating cures (absent context, a site the context never measured, a moved point, a v2 context). A missing or unreadable catalogue throws, and an unreachable dataset produces no verdict.
- 69c7134: Dataset reads and the publisher's PUTs now share one S3 client: signing, key encoding, the retryable-code table, and backoff. The endpoint variable is renamed to the vendor-neutral `METEO_S3_ENDPOINT` (`R2_ENDPOINT` stays honored as an alias). The `freshness` verb is replaced by `publish --dry-run`, which prints the verdict and the plan without uploading. `--cache-closed` is renamed `--cache-closed-months` to match its option. `SITE_FIELDS` derives from the contract's entry schema instead of restating it.

### Patch Changes

- Updated dependencies [e3e5f9a]
- Updated dependencies [69c7134]
- Updated dependencies [59efe10]
  - @azohra/meteo.briefing@0.6.0

## 0.4.0

### Minor Changes

- adfc251: New `meteo forecast publish --model SLUG [--data PATH]` moves the publication protocol into the engine. The verb skips when the build wrote nothing, and refuses to publish backwards (an unreachable bucket throws during that check rather than passing it). Upload order is history archives, then site documents, then the manifest (the publication's commit point), with closed month archives on the immutable TTL; `runs.json` is then regenerated and uploaded from the published manifests. Every object key comes from `documentPaths`, so operator upload scripts no longer restate the layout, the month arithmetic, or the ordering. Cache lifetimes remain the deployment's choice (`--cache-live` / `--cache-closed`, TRIAL defaults, caller-movable). `publishModel` and the pure `publishPlan` are exported for programmatic use, and dataset reads now build their keys from `documentPaths` too.

### Patch Changes

- f2f9fb8: `parseSites` validates the catalogue through the reader contract's `sitesCatalogueSchema` before applying its writer-side identity-only strictness, so both sides read field semantics from one schema. A malformed slug or empty timeZone the old hand-rolled parser accepted is now refused; the strictness divergence is documented in Configure launches. Every schemaVersion the engine stamps (profiles, manifests, smoke, observation, runs index, sites, site context) is imported from `@azohra/meteo.briefing/contract` instead of re-declared.
- Updated dependencies [f2f9fb8]
- Updated dependencies [f2f9fb8]
- Updated dependencies [a217302]
- Updated dependencies [adfc251]
  - @azohra/meteo.briefing@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [6ef2985]
  - @azohra/meteo.briefing@0.4.1

## 0.3.1

### Patch Changes

- 651d8a6: GOES observation documents name their measured quantity: the builder
  publishes `quantity: "downwardShortwave"` on goes18-dsr documents and
  `"aot"` on goes18-aod, and the packaged catalogue's observation entries
  declare the same enum. The field is additive and optional on the
  contract, so documents published before the tag still parse, with
  `quantity` absent.
- Updated dependencies [bc6dfff]
- Updated dependencies [651d8a6]
- Updated dependencies [b78200b]
- Updated dependencies [a08b8fb]
- Updated dependencies [73968f4]
  - @azohra/meteo.briefing@0.4.0

## 0.3.0

### Minor Changes

- 7db8b23: GOES observation entries carry the provider's nonzero DQF as `quality`,
  and the DSR gate widens from DQF = 0 to DQF ≤ 1. A degraded but
  unmasked DSR retrieval (the sunrise and sunset shoulders that the
  exact-zero gate silently dropped from the archive) now publishes
  labelled `quality: 1` instead of not existing, and AOD's accepted
  medium-quality retrievals, previously indistinguishable from high,
  carry the same label. Absence still means the best grade, night still
  publishes as absence through the unmasked half of the gate, and
  rejected qualities are still published as absences rather than zeros.

### Patch Changes

- Updated dependencies [7db8b23]
  - @azohra/meteo.briefing@0.3.0

## 0.2.0

### Minor Changes

- 0f02bcb: Remove the v1 migration machinery. schemaVersion 1 never existed
  publicly (it was one pre-release deployment, migrated once), so the
  `meteo forecast migrate` command, `forecast/src/migrate.ts`, and the
  briefing contract's migration exports (`migrateDocument`, `migrateHour`,
  `migrateSurface`, `migrateLevel`, `WIRE_V1_HOUR_RENAMES`,
  `WIRE_V1_DERIVED_RENAMES`, `WireDocument`, `MigrateDocumentOptions`)
  served no reader and are removed. Published documents start, and have
  always started, at `schemaVersion: 2`.

### Patch Changes

- Updated dependencies [b39a15d]
- Updated dependencies [0a089ca]
- Updated dependencies [6e9651d]
- Updated dependencies [4d34d0b]
- Updated dependencies [0f02bcb]
  - @azohra/meteo.briefing@0.2.0
  - @azohra/meteo.grib@0.1.3

## 0.1.3

### Patch Changes

- Every build now prints a `[wire]` transport report beside its summary line:
  requests and failures, bytes, busy time against wall, mean concurrency,
  latency percentiles, busy throughput, and per-host rows with a cpu split.
  The report reads the same on every provider, so an operator can tell a
  wire-bound tick from a compute-bound one without instrumenting anything.

## 0.1.2

### Patch Changes

- GOES granule fetches run concurrently under the NOAA per-bucket connection
  budget; they were serial. The NAM fetch gate widens from 10 to 14
  connections, sized from measured per-request latency rather than
  bandwidth.
- fbb7e9a: Adopt RRFS, the verified NAM successor, as the `rrfs` catalogue leg: 3 km
  CONUS on exactly HRRR's Lambert grid, hourly steps to 84 h on the 00/06/12/18Z
  cycles (the only cycles that publish the isobaric files), byte-ranged from the
  `noaa-rrfs-pds` bucket (`METEO_RRFS_BASE` re-points the prefix as the
  parallel/production data lands). Geometric DZDT converts to omega at build
  (ω ≈ −ρgw) and is declared `verticalVelocity: "fromGeometricW"`; the RRFS-SD
  smoke block reads the speciated biomass-burning tracer and is declared
  radiatively coupled. Experimental until it survives a production run.
- Updated dependencies [fbb7e9a]
  - @azohra/meteo.grib@0.1.2

## 0.1.1

Initial release: the engine and `meteo` CLI. Fetches each model's newest
run, derives the soaring numbers for every catalogued site, and publishes
versioned JSON documents with append-only history.
