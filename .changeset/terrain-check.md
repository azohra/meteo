---
"@azohra/meteo.forecast": minor
---

`meteo forecast terrain` writes site-context v3 — each entry stamps the catalogue point it measured, verbatim — and gains `--check`: a fresh/stale verdict for the published context against the published catalogue, read through the dataset path. Stale covers everything regenerating cures (absent context, a site the context never measured, a moved point, a v2 context); a missing or unreadable catalogue throws rather than guessing, and an unreachable dataset never reads as a verdict.
