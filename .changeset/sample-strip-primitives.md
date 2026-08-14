---
"@azohra/meteo.station": patch
---

Composition primitives for the live sample window: `sampleRuns` (gap-split
  at the history chart's 2.5-interval tolerance), `sampleScales`,
  `samplePoints`, `sampleMeanDirectionDeg`, `thinSampleVanes`, and
  `samplesSummary`. They mirror the history machinery and return the shared
  `ChartScales` and `Vane` shapes, so `chartFrame`, `vanePath`, and
  `vaneTicks` draw a 3-second sample strip exactly as they draw the six-hour
  chart — hosts compose their own strip rather than mounting a component.
  `nearestIndex` widens to the instant alone (`{ observedAt }`), so the same
  cursor math inspects history points and live samples alike.
