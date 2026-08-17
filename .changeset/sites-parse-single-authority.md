---
"@azohra/meteo.forecast": patch
---

`parseSites` validates the catalogue through the reader contract's `sitesCatalogueSchema` before applying its writer-side identity-only strictness, so field semantics have one authority — a malformed slug or empty timeZone the old hand-rolled parser accepted is now refused, with the strictness divergence documented in Configure launches. Every schemaVersion the engine stamps (profiles, manifests, smoke, observation, runs index, sites, site context) is imported from `@azohra/meteo.briefing/contract` instead of re-declared.
