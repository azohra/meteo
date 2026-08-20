---
"@azohra/meteo.forecast": patch
---

The GEPS and REPS builders — twins in all but their provider facts — merge into one ECCC ensemble engine, the way the deterministic trio already shares `DatamartModel`. An `EnsembleModel` descriptor now carries each model's grid kind, wind-component convention, file naming, cadence, flux treatment, CAPE/CIN presence, and terrain encoding; the sampling, aggregation, and publication machinery exists once. Published documents, manifests, and log lines are unchanged.
