---
"@azohra/meteo.briefing": minor
---

An invalid `DocumentMiss` from the family-aware loaders also carries `supportedSchemaVersion` (the newest version the installed guard parses), so one log line can read "got 3, support 1" without consulting a constant. Callers of the generic `loadDocument`/`loadSiteSet` can thread their own via the new `supportedSchemaVersion` option.
