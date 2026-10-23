---
"@azohra/meteo.core": patch
"@azohra/meteo.forecast": patch
---

Raise the zod floor to `^4.6.7`, which fixes GHSA-mrhx-c7xc-m3w5: validating an oversized array could exhaust memory.
