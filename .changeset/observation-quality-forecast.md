---
"@azohra/meteo.forecast": minor
---

GOES observation entries carry the provider's nonzero DQF as `quality`, and the DSR gate widens from DQF = 0 to DQF ≤ 1. An unmasked degraded DSR retrieval (the sunrise and sunset shoulders the exact-zero gate silently deleted from the archive) publishes labelled `quality: 1` instead of not existing, and AOD's accepted medium-quality retrievals, previously indistinguishable from high, carry the same label. Absence still means the best grade, night still publishes as absence through the unmasked half of the gate, and rejected qualities remain absences, never zero.
