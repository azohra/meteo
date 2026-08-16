---
"@azohra/meteo.briefing": minor
---

Observation entries accept an optional `quality` — the provider's
  nonzero DQF, absent meaning the best grade — and the scene renders it
  per product's own semantics. DSR's binary DQF-1 "degraded/invalid"
  retrievals (the sunrise and sunset shoulders) never join the measured
  Sun line: they draw as dimmed dots (`MetricStrip.degradedDots`,
  classed `${className}-degraded-dot`), and they never shade the dimming
  cells, because a transmittance built on a provider-refused measurement
  would be wrong while looking plausible. AOD's medium-quality entries
  stay in the AOT line — DQF ≤ 1 is the smoke literature's validated set
  — with the grade available for stricter consumers. Pointer packets gain
  `observedIrradianceQuality` and `observedAotQuality`, and the sampling
  row's observation entries carry `quality` when nonzero. Schema
  artifacts regenerated to match.
