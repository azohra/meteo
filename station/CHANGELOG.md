# @azohra/meteo.station

## 0.5.0

### Minor Changes

- dd2d65a: Fix narrow-width rendering and coverage units.
  
  - Chart label rows (compass letters, averages, time captions) now thin to fit the measured width instead of colliding; arrows always draw. `VaneCell.label`/`value` are now nullable, `vaneTicks` takes a label count, and the `dailyPatternCoverage` string takes a precomputed percent.
  - Climatology coverage was denominated in the producer's fed period and could read over 100%. The year ledger gains additive `coveredSlotCount`/`expectedSlotCount`; the percent is computed only from that pair and is withheld on documents without it.
  - `<meteo-station-strip>` wraps instead of clipping in narrow columns.

## 0.4.2

### Minor Changes

- b634597: Add favorable directions, climatology, history browsing, and live-detail components. All additive; schemaVersion stays 2.
  
  - `favorableDirections` joins the display resolution beside `thresholds` (same omitted/value/null trichotomy, no default). The rose and dial draw a verdict ring, vane rows and the `Direction` fragment tint by verdict, and the new `FavorableShare` / `<meteo-favorable-share>` reports the share of non-calm history inside the arcs. The wire gains `StationMeta.declaredFavorableDirections` (the vendor's own declaration, read via `declaredFavorableDirections(station)`; components never apply it as a default) and `broadcastDelaySeconds`.
  - New `StationClimatology` family: the station's whole record as (month, slot, sector) sums, bucketed in station standard time and binned with the consumer's thresholds, with a per-year coverage ledger. Served at `/climatology`, held by a fetch-once store, and re-summed client-side under month/season/slot filters without refetching (verified lossless against `windRose`/`dailyPattern`). `ClimatologyRose` stacks each wedge by speed band with coverage captions; `ClimatologyDailyPattern` draws the cube through the daily-pattern chart.
  - New `StationHistory` document on `/history` with the `StationHistoryFetcher` injection contract, a window-keyed LRU store, and paging math for hosts (`archivePeriodFor` over the vendor's resolution ladder, local calendar-day arithmetic, a trailing-day window). The library ships no archive UI component; hosts compose their own pager.
  - `recentSummaries` on the wire (the source's own 1-min/5-min step digests, a new capability key and `summaries` live frame) feeds the new `RecentSummaries` panels. `CompassFan` draws every sample of the rolling window by age around the needle. `AirExtremes` shows the last completed night's low (`lastNightLowC`, computed from solar events; without coordinates the tile is absent) and the 3 h pressure delta (`pressureDeltaHpa`, also available under `pressureTendency`). The wind chart gains a `nightShading` option using the station's coordinates.
  - WindNerd adapter: the live INIT location block enriches meta (config wins), records parsing reads `wind_avg_2D` and the temperature/pressure spreads onto `HistoryPoint` (`windVectorAvgMps`, min/max fields), the period catalogue widens to the verified `[1, 5, 10, 15, 30, 60, 180, 360]`, the retired `time_offset` column parsing is deleted (`WindnerdRecords` loses `utcOffsetMinutes`), and pre-station empty years parse. All verified against the live vendor.
  - `StationStrings` gains labels and aria sentences for the new surfaces. A hand-built full `StationStrings` object needs the new entries, which is what the minor bump covers. The component gallery grows from twelve sections to fourteen.

### Patch Changes

- Updated dependencies [b634597]
  - @azohra/meteo.core@0.2.0

## 0.3.1

### Patch Changes

- 6a3979f: Add the standalone connectivity contract and the Hologram loader. `stationConnectivitySchema` / `StationConnectivity` (root) model cellular backhaul health — online state, last connect, carrier, radio technology, SIM lifecycle, and billing-period data usage — for the operator's own routes, never the public station feed. `loadHologramConnectivity` (`/server`) reads one device from Hologram's REST API over the shared upstream transport (credential-free cache key, trial 300 s TTL, `UpstreamError` taxonomy) and normalizes Hologram's quirks: naive-UTC stamps, the all-zeros open-session sentinel, flat-rate plans declaring `data: 0`, and the vendor lifecycle words reduced to a neutral `sim.service` enum. There is no signal-strength field: cellular clouds do not expose RSSI, so consumers judge connection quality from radio technology plus session recency.

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
