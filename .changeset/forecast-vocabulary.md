---
"@azohra/meteo.forecast": patch
---

The engine stops re-implementing shared vocabulary: dew-point depression now composes briefing's Magnus pair (`dewPointC` + `dewPointDepressionC`), `normalizeDegrees` and the dry-adiabatic lapse constant are imported from `@azohra/meteo.briefing/derive`, and the sink-rate default is no longer restated back into `usableLiftTopM`. Conversions whose published bytes pin a different floating-point spelling than core's (wind direction from components, the ensemble's circular median, terrain's radians-to-degrees) deliberately stay local, each with a comment naming the divergence. Published values are bit-identical.
