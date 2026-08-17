---
"@azohra/meteo.briefing": minor
---

One schemaVersion constant per document family. The shared `SCHEMA_VERSION` export is gone: manifests pin `MANIFEST_SCHEMA_VERSION`, the model catalogue `MODEL_CATALOGUE_SCHEMA_VERSION`, the run index `RUNS_INDEX_SCHEMA_VERSION`, smoke documents `SMOKE_SCHEMA_VERSION`, and observation documents `OBSERVATION_SCHEMA_VERSION`. Every value is still 1, so no published document changes — only the import name moves. A breaking change to one family now bumps its own constant without invalidating readers of the others.
