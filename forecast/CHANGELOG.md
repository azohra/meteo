# @azohra/meteo.forecast

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
