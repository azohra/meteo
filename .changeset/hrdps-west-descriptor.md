---
"@azohra/meteo.forecast": patch
---

The HRDPS West builder becomes a fourth `DatamartModel` descriptor on the shared ECCC engine instead of a near-copy of it. The descriptor carries the alpha-feed facts — URL grammar, published dew-point depression, PRATE instant-rate precipitation, per-field converts, uncapped nearest-gridpoint sampling — and the engine gained the optional fields those deltas need. Published output and log lines are unchanged.
