---
"@azohra/meteo.briefing": minor
---

Sunrise and sunset join the derive surface: `solarEventsForDate(dateKey,
  latitude, longitude): SolarEvents | null` — a NOAA/Meeus solar-event
  model with two-pass hour-angle refinement and the official zenith of
  90.833°, returning null through polar day and night.
  
  The date key names the solar day at that longitude (the shape
  `localDateKey` produces): correct wherever the civil date matches the
  longitudinal solar date, and a day off only where the date line
  separates the two. Event *times* are the package's; sunrise/sunset marks on a
  chart remain consumer-drawn, as the inspector recipe already prescribes.
  
  `cosSolarZenith` keeps its Spencer parameterization: the cheap bulk
  per-hour form for transmittance, where Meeus's horizon-crossing
  precision buys nothing visible.
