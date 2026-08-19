---
"@azohra/meteo.core": minor
"@azohra/meteo.briefing": patch
---

`DirectionArc`, `inDirectionArcs`, and `directionArcSpanDeg` (FROM bearings; `fromDeg > toDeg` wraps through north; boundaries inclusive) and the Meeus `solarEventsForDate` move to `@azohra/meteo.core`. Briefing's `LaunchWindowArc` becomes an alias, its private containment math now calls the core function, and `solarEventsForDate` is re-exported unchanged. No behaviour change.
