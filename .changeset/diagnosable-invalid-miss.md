---
"@azohra/meteo.briefing": minor
---

An invalid `DocumentMiss` now carries `declaredSchemaVersion` when the refused bytes are well-formed JSON with a numeric `schemaVersion`, so a reader can tell "published by a newer writer — upgrade the package" apart from corruption. The Compatibility page gains the rollout order for a schemaVersion bump: move the writer first, readers promptly after.
