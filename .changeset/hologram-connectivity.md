---
"@azohra/meteo.station": patch
---

Add the standalone connectivity contract and the Hologram loader. `stationConnectivitySchema` / `StationConnectivity` (root) model cellular backhaul health — online state, last connect, carrier, radio technology, SIM lifecycle, and billing-period data usage — for the operator's own routes, never the public station feed. `loadHologramConnectivity` (`/server`) reads one device from Hologram's REST API over the shared upstream transport (credential-free cache key, trial 300 s TTL, `UpstreamError` taxonomy) and normalizes Hologram's quirks: naive-UTC stamps, the all-zeros open-session sentinel, flat-rate plans declaring `data: 0`, and the vendor lifecycle words reduced to a neutral `sim.service` enum. There is no signal-strength field: cellular clouds do not expose RSSI, so consumers judge connection quality from radio technology plus session recency.
