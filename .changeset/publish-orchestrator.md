---
"@azohra/meteo.forecast": patch
---

Every run builder now hands its model-specific parts to one `publishRun` orchestrator that owns run resolution, the already-published gate, and the profile/history/manifest writes — the tail each builder previously open-coded. The Datamart wire machinery (`liveDatamartWire`, `sampleDatamartField`, the lazy J2K pool, `TASK_CONCURRENCY`) moved from the ECCC builder to `providers/datamart`, and one `transportBackoff` formula now backs every retry loop. `--max-steps` reaches all builders — GOES included — as a forwarded option; the internal `METEO_MAX_STEPS` bridge is gone. Log lines standardize on "downloads", pinned-cycle errors on one grammar. Published documents, manifests, and archives are byte-identical.
