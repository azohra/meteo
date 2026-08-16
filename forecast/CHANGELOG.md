# @azohra/meteo.forecast

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
