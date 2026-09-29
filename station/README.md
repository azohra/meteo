# `@azohra/meteo.station`

Live weather stations for meteo by Azohra. Adapters read WindNerd,
WeatherFlow Tempest, Campbell Scientific loggers, Ecowitt, or your own
hardware and convert it to one wire contract. A handler you mount on your
server serves every station as a single feed, and React components or
custom elements render that feed on your page in your own styles, without a
vendor iframe.

## Surface

| Entry point | What it is |
|---|---|
| `@azohra/meteo.station` | Runs on server and client. The wire contract (zod); the separate connectivity contract, `StationConnectivity`, which reports cellular backhaul health on the operator's own routes and is never part of the public feed; pure derivations (period stats, compass, freshness, unit and threshold conversion); chart and instrument geometry; and the display rules both bindings share (strings, formatting, air sentences, display resolution, merge policy). |
| `@azohra/meteo.station/client` | The framework-free client data layer: `createJsonPoller` and the station stores (`createStationFeedStore`, `createStationCurrentStore`, `createStationStore`) every binding subscribes to. It runs only in the browser but is safe to import anywhere. |
| `@azohra/meteo.station/server` | Vendor adapters plus the custom-adapter interface and `defineStationAdapter`, data-level `loadStationFeed()` / `loadStationCurrent()`, the Hologram connectivity loader (`loadHologramConnectivity`), and the mountable feed handler. It is server-only, so it cannot end up in a client bundle. |
| `@azohra/meteo.station/react` | `StationFeedProvider`, polling hooks (`useStation`, `useStationFeed`, `useStationCurrent`), the component set (`StationCard`, `CurrentConditions`, `WindHistoryChart`, `WindSampleStrip`, `TrendChart`, `WindRose`, `DailyPattern`, `StationTable`, `StationStrip`, `AirMatrix`, `FreshnessBadge`), and an atoms layer of inline primitives (`Speed`, `Gust`, `Lull`, `Temperature`, `Pressure`, `Direction`, `UpdatedAt`, `BandChip`, `Dial`, `Sparkline`, `Readout`) for composing your own layouts. |
| `@azohra/meteo.station/elements` | The same surface as light-DOM custom elements (`<meteo-station-feed>`, `<meteo-station-card>`, `<meteo-station-table>`, the charts, the atoms…), with the same features as the React binding and no framework. A parity suite keeps the two byte-identical. Import `/register` to define every element. |
| `@azohra/meteo.station/styles.css` | The default skin (an intentional side effect), shared by both bindings. |

## Example

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

The documentation is in [`docs/`](docs/) and published at
<https://meteo.azohra.com/docs/station/>. JSON Schema for the wire
documents is in [`schema/`](schema/).

## Stability

The package is pre-1.0. The wire contract and environment helpers are
stable, and the handler's internals are not. Pin a minor version if you use
anything beyond the documented surface.

MIT © Justin Watts
