# `@azohra/meteo.station`

The **station** capability of meteo by Azohra: one wire contract, vendor
adapters that normalize into it (WindNerd, WeatherFlow Tempest, Campbell
Scientific loggers, Ecowitt, or your own), a mountable `Request → Response` handler
that serves the whole inventory as a single feed, and hooks and components
that render it natively, in your design system, with no vendor iframe.

## Surface

| Entry point | What it is |
|---|---|
| `@azohra/meteo.station` | The isomorphic root: the wire contract (zod), the standalone connectivity contract (`StationConnectivity` — cellular backhaul health for the operator's own routes, never the public feed), pure derivations (period stats, compass, freshness, unit and threshold conversion), framework-free chart and instrument geometry, and the shared display rules (strings, formatting, air sentences, display resolution, merge policy) every binding renders from. |
| `@azohra/meteo.station/client` | The framework-free client data layer: `createJsonPoller` and the station stores (`createStationFeedStore`, `createStationCurrentStore`, `createStationStore`) every binding subscribes to. Client-only at runtime, import-safe anywhere. |
| `@azohra/meteo.station/server` | Vendor adapters plus the custom-adapter interface and `defineStationAdapter`, data-level `loadStationFeed()` / `loadStationCurrent()`, the Hologram connectivity loader (`loadHologramConnectivity`), and the mountable feed handler. Server-only, so it can never leak into a client bundle. |
| `@azohra/meteo.station/react` | `StationFeedProvider`, polling hooks (`useStation`, `useStationFeed`, `useStationCurrent`), the component set (`StationCard`, `CurrentConditions`, `WindHistoryChart`, `WindSampleStrip`, `TrendChart`, `WindRose`, `DailyPattern`, `StationTable`, `StationStrip`, `AirMatrix`, `FreshnessBadge`), and an atoms layer of inline primitives (`Speed`, `Gust`, `Lull`, `Temperature`, `Pressure`, `Direction`, `UpdatedAt`, `BandChip`, `Dial`, `Sparkline`, `Readout`) for composing your own layouts. |
| `@azohra/meteo.station/elements` | The same surface as light-DOM custom elements (`<meteo-station-feed>`, `<meteo-station-card>`, `<meteo-station-table>`, the charts, the atoms…), a full peer of the React binding, framework-free, held byte-identical by a parity suite. `/register` is the auto-defining one-liner. |
| `@azohra/meteo.station/styles.css` | The default skin (an intentional side effect), shared by both bindings. |

## Taste

```tsx
import { StationFeedProvider, useStation, StationCard } from "@azohra/meteo.station/react";
import "@azohra/meteo.station/styles.css";

function LiveWind() {
  const { feed, receivedAtMs } = useStation("/api/wind", "launch");
  if (!feed) return null;
  return (
    <div className="meteo-root">
      <StationFeedProvider feed={feed} receivedAtMs={receivedAtMs}
        thresholds={{ unit: "kmh", values: [12, 20, 28] }}>
        <StationCard />
      </StationFeedProvider>
    </div>
  );
}
```

## Documentation

Station's reference lives in [`docs/`](docs/) and is served at
<https://meteo.azohra.com/docs/station/>.

JSON Schema for the wire documents lives in [`../schema/`](../schema/).

## Stability

Pre-1.0: the wire contract and environment helpers are stable; handler
internals are not. Pin a minor version if you reach past the documented
surface.

MIT © Justin Watts
