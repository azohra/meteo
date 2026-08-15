---
"@azohra/meteo.briefing": patch
---

The AOD observation's describe strings now name the profile's `smoke`
  block as the forecast counterpart of measured `aot`. They previously said
  the smoke document forecasts `aot`; the smoke document carries no
  optical-depth field — the forecast `aot` lives in the profile's
  per-hour `smoke` block. Schema artifacts regenerated to match.
