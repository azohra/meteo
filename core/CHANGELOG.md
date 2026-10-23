# @azohra/meteo.core

## 0.3.1

### Patch Changes

- Raise the zod floor to `^4.6.7`, which fixes GHSA-mrhx-c7xc-m3w5: validating an oversized array could exhaust memory.

## 0.3.0

### Minor Changes

- c80493a: `msToKmh` moves to `@azohra/meteo.core` beside its inverse `kmhToMps`; `@azohra/meteo.briefing/derive` re-exports it unchanged, so briefing's public surface stays put.

## 0.2.0

### Minor Changes

- b634597: `DirectionArc`, `inDirectionArcs`, and `directionArcSpanDeg` (FROM bearings; `fromDeg > toDeg` wraps through north; boundaries inclusive) and the Meeus `solarEventsForDate` move to `@azohra/meteo.core`. Briefing's `LaunchWindowArc` becomes an alias, its private containment math now calls the core function, and `solarEventsForDate` is re-exported unchanged. No behaviour change.

## 0.1.1

Initial release: the shared vocabulary. Units, angle and wind-vector math
with one sign convention platform-wide, zod primitives, the transport
failure vocabulary, and schema-artifact tooling.
