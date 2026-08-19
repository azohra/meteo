---
"@azohra/meteo.core": minor
"@azohra/meteo.briefing": patch
"@azohra/meteo.station": minor
---

Core exports `DirectionArc` (`{ fromDeg, toDeg }`, meteorological FROM bearings, `fromDeg > toDeg` wraps through north, boundaries inclusive), `inDirectionArcs`, and `directionArcSpanDeg`. Briefing's `LaunchWindowArc` and station's `FavorableDirection` become aliases of it, and briefing's private containment math is replaced by the core function; behaviour is unchanged. Station additionally exports `favorableShare(points, arcs)` (the share of non-calm history inside the consumer's arcs; `null` when nothing non-calm was measured) and `historyCoverage(points, periodMinutes, fromMs, toMs)` (points held against the count the requested window implies, so leading and trailing dropouts lower the ratio). No wire change in any package.
