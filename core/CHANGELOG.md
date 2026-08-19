# @azohra/meteo.core

## 0.2.0

### Minor Changes

- b634597: `DirectionArc`, `inDirectionArcs`, and `directionArcSpanDeg` (FROM bearings; `fromDeg > toDeg` wraps through north; boundaries inclusive) and the Meeus `solarEventsForDate` move to `@azohra/meteo.core`. Briefing's `LaunchWindowArc` becomes an alias, its private containment math now calls the core function, and `solarEventsForDate` is re-exported unchanged. No behaviour change.

## 0.1.1

Initial release: the shared vocabulary. Units, angle and wind-vector math
with one sign convention platform-wide, zod primitives, the transport
failure vocabulary, and schema-artifact tooling.
