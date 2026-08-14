---
title: React
description: Hooks that poll a mounted feed and components that render it — the provider, thresholds, composition, primitives, and SSR seeding.
---

`@azohra/meteo.station/react`: hooks that poll a mounted feed
([getting started](/docs/station/getting-started/)) and components that
render it, themed via the tokens in [Theming](/docs/station/theming/).

<!-- meteo-doc-fence: ignore — a CSS side-effect import; there are no type declarations to check -->
```ts
import "@azohra/meteo.station/styles.css"; // the default skin (an intentional side effect)
```

## Hooks

The hooks are thin react shells over the shared
[client data layer](/docs/station/client-data/)
(`@azohra/meteo.station/client`) — the polling semantics, cadence rules,
merge clock rule, and structured errors are documented once there and owed
to every binding identically. Every hook takes the **mount base** (e.g.
`"/api/wind"`) and builds its own route — nobody passes a full endpoint:

- `useStation(url, stationId, options)` → `{ feed, station, receivedAtMs, error, refresh }`.
  Composes the two hooks below plus the `foldCurrent` merge-and-clock rule.
- `useStationFeed(url, options)` → `{ feed, error, receivedAtMs, refresh }`. Polls
  `${url}/feed` at the fleet's advised cadence.
- `useStationCurrent(url, stationId, options)` polls `${url}/current?station=<id>`; fold
  it into the full feed with `mergeCurrent(feed, current)` — or just use `useStation`.
- Options: `pollSeconds`, `currentPollSeconds` (useStation), `enabled`, `fetchInit`
  (its latest value rides every poll; the loop's own abort signal always wins), and
  `initialData`.

`useFreshness(observedAt, servedAt, receivedAtMs, thresholds?)` grades an
observation for display — the semantics are the wire contract's
[freshness model](/docs/station/wire-contract/#freshness-the-servedat-anchor),
re-judged on the shared 30 s cadence.

`useMeasuredChartWidth(ref)` measures a chart container the way the
built-in charts do — a ResizeObserver behind the measure-or-fallback rule
(`measuredChartWidth` on the root), null until a width exists. Frame a
custom SVG at this measured pixel width; a fixed viewBox stretched by CSS
magnifies every label and stroke.

## The provider

`StationFeedProvider` is the package-wide ambient default: it carries
`{ feed, receivedAtMs }` (servedAt is read off the feed) plus the display
defaults `strings`, `unit`, `formatTime`, `thresholds`, and an optional
`locale` that pins the default time format so SSR and hydration passes agree.
Every component's data and display props become optional overrides over it —
an explicit prop always wins, and components still work fully via explicit
props with no provider anywhere.

Per-station components inside a provider resolve their station in this order:
an explicit `station` prop → a `stationId` prop looked up in the feed → the
feed's `primaryStationId` → `stations[0]`. A component that resolves nothing
throws a wiring error rather than rendering a mystery blank.

## Thresholds

**Thresholds are unit-explicit**: `thresholds: { unit, values }` speaks the
consumer's vocabulary (`{ unit: "kmh", values: [12, 20, 28] }`) and is
converted to the m/s wire once, internally (`thresholdsToMps`, exported from
`@azohra/meteo.station` next to the other unit conversions) — chart guide
labels print the numbers you declared, never round-tripped wire values.
Inside a provider, `thresholds={null}` opts one component out of the ambient
grading — the omitted/value/null trichotomy is the shared
[display-resolution rule](/docs/station/client-data/#display-resolution--shared-across-bindings),
applied identically by every binding. Bands map to `meteo-band-0..n` classes;
the colours are [yours](/docs/station/theming/#speed-bands-and-your-palette).

## Components

Wind-speed components are display-unit aware (`unit?: "kmh" | "knots" | "mph" | "mps"`,
default `"kmh"`) and all take `strings` (word overrides / i18n); components
that print a timestamp also take `formatTime`.
Per-station components take `station` (or `stationId`); fleet components take `stations`.

| Component | Props that matter |
|---|---|
| `StationCard` | The station card, a compound (below). `station`/`stationId`, `servedAt`, `receivedAtMs`, `thresholds`, `unit` |
| `CurrentConditions` | The instrument dial. Same props; calm hides the needle, outages grey the dial |
| `WindHistoryChart` | Lull–gust band + graded mean, a persistent compass-letter row and Avg row above/below every vane. `thresholds` (guide labels show your declared numbers), `plotHeight`, `windowHours` (slices to the trailing N hours of the SAME points, no new fetch), `compareOffsetDays` (`1 \| 2 \| 3`; overlays a prior day's trace shifted onto today's own x-axis, absent when history doesn't reach back far enough) |
| `WindSampleStrip` | The history chart's live sibling: the rolling sample window over the same frame, grid, compass-letter and avg rows, and edge-anchored ticks. Samples-only by design — pass `samples` (from `useStationLive`) and `stationName`; instants stay ungraded, a dropout breaks the trace, a one-sample run draws as a dot. `plotHeight` |
| `TrendChart` | Temperature (°C) or sea-level pressure (hPa) over history. `series: "temperature" \| "pressure"`; null gaps break the trace, never interpolated. No `unit` — the units are the series' own |
| `WindRose` | Direction shares. `station`/`stationId` or raw `points`, `sectorCount`, `thresholds`, `favorableDirections`. No `unit` — the rose shows percentages |
| `DailyPattern` | A typical day: every point bucketed by time-of-day and vector-averaged, with a persistent compass-letter row and Avg row (dashed for a slot nothing ever fell into). `station`/`stationId` or raw `points`, `slotMinutes` (default 180), `utcOffsetMinutes`, `thresholds` |
| `StationTable` | One row per `stations` entry; unavailable rows keep their geometry. `servedAt`, `receivedAtMs`, `stationMeta` — the sub-label under each name (default: the source attribution; render the sampling window, a distance, anything the station itself can say) |
| `StationStrip` | One station on one line — name, wind, lull/gust, FROM, temp, updated + freshness. `station`/`stationId`, `servedAt`, `receivedAtMs`. Absent values dash in place; a capability the station lacks omits its cell; an unavailable station keeps the line, reason in words |
| `AirMatrix` | Humidity → lightning behind a live disclosure; columns only for conditions-capable `stations` |
| `FreshnessBadge` | A dot and a word, from `useFreshness` |

`receivedAtMs` is `number | null` everywhere — null (feed still loading) simply withholds
the freshness badge.

### Composing the station card

`StationCard` is a context provider: with **no children authored** it renders
the full card (header, instrument, chart, summary); with children you say
which pieces appear, in what order, without re-threading props. The trigger
is `children === undefined` — authored children that evaluate to `false` or
`null` (a `{cond && <X/>}` expression) still mean composition mode, so a
condition going false never surprise-renders the whole default card. Each
piece also accepts explicit props that override the card's context — one
chart can wear its own thresholds. Pieces ride the root as properties and as
flat named exports (`StationCardChart` et al., for toolchains that dislike
dot-access across an RSC client boundary); rendering one outside
`<StationCard>` throws.

```tsx
<StationCard stationId="launch" unit="knots">
  <StationCard.Header />
  <StationCard.Chart thresholds={{ unit: "knots", values: [6, 11, 15] }} />
  <StationCard.Summary />
</StationCard> {/* no instrument: the station table above already states the reading */}
```

### The rose's judgment ring

`favorableDirections={[{ fromDeg: 260, toDeg: 340 }]}` (degrees FROM; sectors
may wrap through north) draws a thin ring outside the rose's grid: favourable
arcs in `--meteo-wind-favorable`, the remainder in `--meteo-wind-unfavorable`. The ring
judges direction, the petals report distribution — the two never mix.

## Primitives

The smallest reading fragments as standalone inline elements, for composing
your own layouts out of package-consistent pieces. They share the component
set's discipline: a value the station cannot report is an em dash **in
place** (a lacking capability and an unavailable station earn the same dash),
calm is said in the calm word — the dash on a direction is reserved for a
dead vane on a blowing reading — and shown speeds convert to the display unit
while the wire value rides the `<data>` element's `value` attribute in m/s,
unrounded.

| Primitive | Renders |
|---|---|
| `Speed` / `Gust` / `Lull` | The converted integer + unit word in a `<data>`; gust and lull dash without the `gustLull` capability |
| `Temperature` | One decimal with the degree word |
| `Pressure` | Sea-level pressure, one decimal hPa (needs the `conditions` capability) |
| `Direction` | Arrow glyph + compass point + rounded degrees; calm in a word, dead vane dashes. The aria sentence spells the point out (`compassSpoken` + `aria.direction` strings) |
| `UpdatedAt` | Ticking relative age ("just now", "3 min ago"; the `updated` strings group), falling back to the absolute `formatTime` words past ~6 hours. Server-anchored when `servedAt`/`receivedAtMs` exist |
| `BandChip` | The reading graded against `thresholds`, worn as a chip with `data-band`. Your `labels` (values.length + 1 words) supply the vocabulary; without labels the chip states the converted speed. Calm says the calm word, ungraded |
| `Dial` | The instrument's gauge alone — `CurrentConditions` without flanks or rows. `size` scales the rendered box, never the drawing |
| `Sparkline` | The served history window at word size: lull–gust band + average trace, the big chart's dropout and null-pair rules, `thresholds` grading per segment. A quiet station holds the same fixed box |
| `Readout` | The charts' inspection line: an `<output>` with a bold lead (`strong`) and a `parts` tail of text and wind-arrow pieces. Pass `ariaLive` polite at rest and off while a pointer previews, so a pin announces and a sweep never floods a screen reader |

They compose inline — a sentence, a table cell, a board row:

```tsx
<StationFeedProvider feed={feed} receivedAtMs={receivedAtMs} unit="knots">
  <p>
    <Speed /> <Direction />, gusting <Gust />, <UpdatedAt />
  </p>
</StationFeedProvider>
```

Provider resolution is the standard one: an explicit `station` prop → a
`stationId` looked up in the ambient feed → `primaryStationId` →
`stations[0]`; resolving nothing throws the wiring error, and every primitive
still works with zero provider via explicit props.

## SSR and App Router

`"use client"` is baked into every react module — import straight into an App Router
tree, no wrapper files. Components render fully under `renderToString` (the chart draws
after its first client-side measurement), and freshness is computed from `receivedAtMs`,
not the wall clock, so server and client markup agree. The default time format resolves
the runtime's locale lazily — pass `locale` on `StationFeedProvider` (or your own
`formatTime`) when server and client locales may differ. To skip the client's blank first
paint, fetch the feed in a server component and seed the hook:

```tsx
const body = await fetch(FEED_URL).then((r) => r.text());
const feed = parseStationFeedJson(body); // from @azohra/meteo.station
// pass { feed, receivedAtMs: Date.now() } to useStation's / useStationFeed's initialData
```

## Board cells

For a compact per-station line on an overview board, use `StationStrip` — it
resolves its station like every other per-station component, and the dashes,
capability gating, and freshness badge come with it:

```tsx
import { StationFeedProvider, StationStrip, useStationFeed } from "@azohra/meteo.station/react";

function BoardRow({ url }: { url: string }) {
  const { feed, receivedAtMs } = useStationFeed(url);
  return (
    <div className="meteo-root">
      <StationFeedProvider feed={feed} receivedAtMs={receivedAtMs} unit="knots">
        {feed?.stations.map((station) => (
          <StationStrip key={station.id} stationId={station.id} />
        ))}
      </StationFeedProvider>
    </div>
  );
}
```

The recipe below remains for **fully custom cells** — when the board's markup
is yours and the library supplies only the data, the units, and the badge:

```tsx
import { speedFromMps, speedUnitLabel, stationFreshnessThresholds } from "@azohra/meteo.station";
import { FreshnessBadge, useFreshness, useStationFeed } from "@azohra/meteo.station/react";

function BoardCell({ url }: { url: string }) {
  // url is the mount base; the hook polls `${url}/feed`.
  const { feed, receivedAtMs } = useStationFeed(url, { fetchInit: { cache: "no-store" } });
  const station = feed?.stations.find((s) => s.id === feed.primaryStationId) ?? feed?.stations[0];
  const status = useFreshness(
    station?.reading?.observedAt, feed?.servedAt, receivedAtMs,
    station ? stationFreshnessThresholds(station) : undefined,
  );
  if (!station) return null;
  return (
    <div className="meteo-root">
      <strong>{station.name}</strong>{" "}
      {station.reading
        ? `${Math.round(speedFromMps(station.reading.windAvgMps, "knots"))} ${speedUnitLabel("knots")}`
        : "—"}
      {status && <FreshnessBadge status={status} />}
    </div>
  );
}
```

## Stability

Pre-1.0: the wire contract and environment helpers are stable; handler
internals are not. Pin a minor version if you reach past the documented
surface.
