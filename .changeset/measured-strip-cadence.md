---
"@azohra/meteo.briefing": minor
---

The measured Sun and AOT strips draw every observation at the product's
  own cadence instead of one nearest-instant sample per rendered hour.
  Three defects fall out of the old hourly join: sub-hour structure (a
  cloud shadow crossing between hour posts) was invisible, a lone
  surviving retrieval rendered as a bare SVG moveto — real data drawn as
  nothing — and the unmeasured remainder of the window was
  indistinguishable from a data gap.
  
  A measured line now stops at its data (no plot-edge extension), breaks
  across gaps wider than the new `measurementGapMinutes` option (TRIAL
  default `DEFAULT_MEASUREMENT_GAP_MINUTES`, 45 — bridges consecutive
  ten-minute granules, breaks on outages and night), and surfaces lone
  samples as dots (`MetricStrip.dots`, classed `${className}-dot`). The
  region past the newest measured instant renders as a pending tint
  (`MetricStrip.measuredToX`, class `meteo-gram-strip-pending`), so an
  in-progress day reads as filling in rather than broken. Dimming/haze
  cells, pointer packets, and the sampling row keep their hourly
  nearest-instant joins.
