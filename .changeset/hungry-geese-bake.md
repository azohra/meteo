---
"@azohra/meteo.briefing": minor
---

UTC instants now require seconds. Since zod 4.5, `z.iso.datetime()` rejects a minute-only instant such as `2026-08-09T00:00Z`, so the contract guards and the shipped JSON Schemas reject it too; `2026-08-09T00:00:00Z` and fractional seconds still parse. RFC 3339, which the schemas declare as `format: date-time`, already required seconds, and every writer in this repository emits them. The zod floor rises to `^4.6.7`, which fixes GHSA-mrhx-c7xc-m3w5.
