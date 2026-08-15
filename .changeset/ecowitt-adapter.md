---
"@azohra/meteo.station": minor
---

A fourth built-in vendor: Ecowitt. `vendor: "ecowitt"` reads the Ecowitt
  cloud's `real_time` endpoint for arrays behind a GW2000/GW3000-class
  gateway — the WS90 Wittboy and its siblings — and normalizes the latest
  report onto the wire.
  
  - The request pins SI unit ids (°C, hPa, m/s, mm, W/m²), so the adapter
    never converts vendor units; every payload value is validated as a
    finite number in those units.
  - Rain reads the piezo group a WS90 fills and falls back to a tipping
    bucket's; sea-level pressure is the adapter's own reduction of the
    gateway's absolute pressure through the configured elevation, never the
    user-calibrated `relative` value.
  - WS90 supply volts travel as battery telemetry, gated by the `hasBattery`
    config flag; lull and wind chill are not measured and stay null.
  - Cloud refusals arrive as HTTP 200 envelopes: non-zero codes degrade the
    station with Ecowitt's own code and message, the busy and over-limit
    codes as `rate_limited`.
  
  Exports: `ecowittStationConfigSchema`, `loadEcowittStation`,
  `parseEcowittRealTime`, and the `EcowittStationConfig`,
  `EcowittAdapterOptions`, `EcowittObservation` types on
  `@azohra/meteo.station/server`.
