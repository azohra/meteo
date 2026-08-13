---
"@azohra/meteo.forecast": patch
"@azohra/meteo.grib": patch
---

Adopt RRFS, the verified NAM successor, as the `rrfs` catalogue leg: 3 km
CONUS on exactly HRRR's Lambert grid, hourly steps to 84 h on the 00/06/12/18Z
cycles (the only cycles that publish the isobaric files), byte-ranged from the
`noaa-rrfs-pds` bucket (`METEO_RRFS_BASE` re-points the prefix as the
parallel/production data lands). Geometric DZDT converts to omega at build
(ω ≈ −ρgw) and is declared `verticalVelocity: "fromGeometricW"`; the RRFS-SD
smoke block reads the speciated biomass-burning tracer and is declared
radiatively coupled. Experimental until it survives a production run.

`@azohra/meteo.grib` parses the idx tokens past the forecast field into
`IdxRecord.qualifier`, and `findRecord` accepts an optional qualifier —
RRFS-SD publishes smoke and dust under identical variable/level/forecast
triples, so species selection needs the qualifier to be deterministic.
