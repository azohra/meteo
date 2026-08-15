# @azohra/meteo.station

## 0.3.0

### Minor Changes

- d64846c: Add four exports first proven in a downstream consumer.
  
  - `historyMeanDirectionDeg` joins the root exports: the circular mean
    over a history window's blowing points — calm points and dead-vane
    nulls contribute nothing, an all-calm window stays null. It always
    existed in the geometry; only the root name was missing (core's
    `meanDirectionDeg` holds the unqualified name).
  - `COMPASS_POINTS` — the ordered 16-point compass list — ships from the
    root beside its `CompassPoint` type; no more deep import for the value.
  - `useMeasuredChartWidth` measures before first paint: a synchronous
    read in a layout effect (`useEffect` on the server) replaces the
    after-paint read that landed a frame late and visibly rescaled the
    chart, and zero-width measurements are ignored — a hidden container
    used to clamp to the guessed fallback width and rescale when shown;
    the hook now stays held (null) until the container is visible. The
    rule is unchanged: null until measured, the fallback width only where
    `ResizeObserver` is missing.
  - `workersCache()` on `@azohra/meteo.station/server`: a `FeedCache` over
    the ambient Cloudflare Workers `caches.default`, undefined off-platform
    so callers fall back to `memoryCache()`. Keys ride a synthetic host
    because the Workers cache refuses URLs with non-standard ports.

### Patch Changes

- b0e1d15: A fourth built-in vendor: Ecowitt. `vendor: "ecowitt"` reads the Ecowitt
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

## 0.2.0

### Minor Changes

- 8a22dc1: Add the live sample strip and publish the chart-width measuring rule.
  
  - New `WindSampleStrip` on `/react`: the same frame, grid, compass-letter and avg vane rows, edge-anchored ticks, and pin-by-timestamp inspector as the history chart, over the rolling sample window. Samples only: instants stay ungraded, a dropout breaks the trace into runs, and a one-sample run draws as a dot (`meteo-sample-*` classes, riding the existing tokens).
  - New `useMeasuredChartWidth(ref)` on `/react`, and `measuredChartWidth`, `tickAnchor`, `TickAnchor`, and `CHART_FALLBACK_WIDTH` on the root: the measure-before-framing rule the built-in charts follow, for hosts composing their own strips. Build the frame at a measured pixel width; a fixed viewBox stretched by CSS magnifies every label and stroke.
  - New `Readout` atom on `/react` (with the `ReadoutPart` type): the charts' inspection `<output>` idiom, with a bold lead, a text or wind-arrow tail, and aria-live polite at rest, off while previewing.
  - `StationStrings` gains `noSamples` and `aria.sampleStrip`. Overrides are unaffected; a hand-built full `StationStrings` object needs the two new entries, hence the minor bump.

## 0.1.3

### Patch Changes

- 0c456ff: Composition primitives for the live sample window: `sampleRuns` (gap-split
  at the history chart's 2.5-interval tolerance), `sampleScales`,
  `samplePoints`, `sampleMeanDirectionDeg`, `thinSampleVanes`, and
  `samplesSummary`. They mirror the history machinery and return the shared
  `ChartScales` and `Vane` shapes, so `chartFrame`, `vanePath`, and
  `vaneTicks` draw a 3-second sample strip exactly as they draw the six-hour
  chart — hosts compose their own strip rather than mounting a component.
  `nearestIndex` widens to the instant alone (`{ observedAt }`), so the same
  cursor math inspects history points and live samples alike.

## 0.1.2

### Patch Changes

- Add the WindNerd live arm: `windnerd.net/api/live-url/<stationKey>` (SSE),
  alongside the existing records endpoint.
  
  Units fix: every WindNerd speed — records series, digest blocks, live
  samples — is m/s, not km/h; the vendor's own dashboard multiplies by 3.6
  for display (verified 2026-08-14 against location 240's hourly table). The
  adapter previously divided by 3.6, serving every wind reading and history
  point 3.6× low. Plausibility bounds move to 0–140 m/s and the parsed-record
  fields rename to `averageSpeedMps`/`gustSpeedMps`/`lullSpeedMps`.
  Current mode now reads the stream's INIT frame and hangs up — fresher
  reading, the 3-second sample ring, and battery telemetry, cached 15 s with
  records as the fallback — while full mode and history stay on records.
  
  Additive wire contract (schemaVersion stays 2): `LiveSample`/`LiveSamples`
  (instantaneous samples, distinct from `HistoryPoint` period means),
  `telemetry.batteryVoltage` (device health beside the reading, never inside
  `conditions`), nullish `live` and `battery` capability keys, ok-arm
  `samples`/`telemetry` blocks, and the `StationLiveFrame` union
  (`init`/`samples`/`reading`/`ping`/`unavailable`) with
  `parseStationLiveFrame(Json)` and a `stationlive.schema.json` artifact.
  WindNerd config grows `hasBattery` (default false — OnSpot hardware).
  
  New surfaces: `openWindnerdLive` / `openStationLive` (one call, one upstream
  connection; connect rejects, open streams degrade to a terminal
  `unavailable` frame), `encodeStationLiveSse` + `STATION_LIVE_SSE_HEADERS`
  as the host fan-out seam, a `GET …/live?station=<id>` handler route
  (uncached SSE), `fetchUpstreamStream` (connect-only deadline) in the
  environment, `liveEndpoint`, `createStationLiveStore` (backoff, idle
  watchdog, visibility gating, rolling deduped sample window) with
  `liveSnapshotToCurrent`, a `live` option on `createStationStore`, and
  `useStationLive` plus a `live` option on `useStation`.

## 0.1.1

Initial release. Live weather stations: one wire contract, vendor adapters (WindNerd,
Tempest, Campbell), a mountable feed handler, a framework-free client
layer, and peer React and custom-element bindings.
