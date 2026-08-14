---
"@azohra/meteo.station": minor
---

Add the live sample strip and publish the chart-width measuring rule.
  
  - New `WindSampleStrip` on `/react`: the same frame, grid, compass-letter and avg vane rows, edge-anchored ticks, and pin-by-timestamp inspector as the history chart, over the rolling sample window. Samples only: instants stay ungraded, a dropout breaks the trace into runs, and a one-sample run draws as a dot (`meteo-sample-*` classes, riding the existing tokens).
  - New `useMeasuredChartWidth(ref)` on `/react`, and `measuredChartWidth`, `tickAnchor`, `TickAnchor`, and `CHART_FALLBACK_WIDTH` on the root: the measure-before-framing rule the built-in charts follow, for hosts composing their own strips. Build the frame at a measured pixel width; a fixed viewBox stretched by CSS magnifies every label and stroke.
  - New `Readout` atom on `/react` (with the `ReadoutPart` type): the charts' inspection `<output>` idiom, with a bold lead, a text or wind-arrow tail, and aria-live polite at rest, off while previewing.
  - `StationStrings` gains `noSamples` and `aria.sampleStrip`. Overrides are unaffected; a hand-built full `StationStrings` object needs the two new entries, hence the minor bump.
