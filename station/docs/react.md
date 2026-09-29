---
title: React
description: "Hooks that poll a mounted feed and components that render it, with the provider, thresholds, card composition, primitives, and SSR seeding."
---

`@azohra/meteo.station/react` has hooks that poll a mounted feed
([getting started](/docs/station/getting-started/)) and components that
render it. The components are themed with the tokens in
[Theming](/docs/station/theming/).

<!-- meteo-doc-fence: ignore — a CSS side-effect import; there are no type declarations to check -->
```ts
import "@azohra/meteo.station/styles.css"; // the default skin (an intentional side effect)
```

## Hooks

The hooks are thin React wrappers over the shared
[client data layer](/docs/station/client-data/)
(`@azohra/meteo.station/client`). That page documents the polling
semantics, cadence rules, merge clock rule, and structured errors once, and
every binding follows them the same way. Every hook takes the **mount base**
(for example `"/api/wind"`) and builds its own route, so you never pass a
full endpoint.

- `useStation(url, stationId, options)` returns `{ feed, station, receivedAtMs, error, refresh }`.
  It composes the two hooks below with the `foldCurrent` merge-and-clock rule.
- `useStationFeed(url, options)` returns `{ feed, error, receivedAtMs, refresh }`. It polls
  `${url}/feed` at the fleet's advised cadence.
- `useStationCurrent(url, stationId, options)` polls `${url}/current?station=<id>`. Fold
  the result into the full feed with `mergeCurrent(feed, current)`, or use `useStation` instead.
- `useStationLive(url, stationId, { enabled, fetchInit, windowSeconds })` returns
  `{ station, samples, status, servedAt, receivedAtMs, error }`. It subscribes to the
  `${url}/live` stream. Status, backoff, and the rolling sample window come from
  [the live store](/docs/station/client-data/#the-live-store).
- The options are `pollSeconds`, `currentPollSeconds` (useStation), `enabled`, `fetchInit`,
  and `initialData`. The latest `fetchInit` value is sent with every poll, and the loop's
  own abort signal always takes precedence over one in `fetchInit`. `useStation` also takes
  `live?: boolean`. With `live: true` it replaces its current poll with the `/live` stream;
  the feed poll and the fold stay the same.

Live is a per-station capability, and today only WindNerd declares it
([What your hardware shows](/docs/station/what-your-hardware-shows/)). For
a station without `live`, `/live?station=` answers 404 and the live store
stays in `backoff`. Use `useStationLive` and `live: true` only for stations
that declare it. The custom-elements binding has no live surface and only
polls.

`useFreshness(observedAt, servedAt, receivedAtMs, thresholds?)` grades an
observation for display. It follows the wire contract's
[freshness model](/docs/station/wire-contract/#freshness-the-servedat-anchor)
and re-grades on the shared 30 s cadence.

`useMeasuredChartWidth(ref)` measures a chart container before first
paint and measures it again on resize. The width stays null until a real
one exists. A hidden container measures zero, so the hook stays null until
the container is shown. The fallback width (`CHART_FALLBACK_WIDTH` on the root)
applies only where ResizeObserver is missing. Size a custom SVG to this measured pixel
width. If CSS stretches a fixed viewBox, every label and stroke scales up
with it.

## The provider

`StationFeedProvider` supplies package-wide defaults to every component
inside it. It carries `{ feed, receivedAtMs }` (servedAt is read from the
feed) and the display defaults `strings`, `unit`, `formatTime`, and
`thresholds`. An optional `locale` fixes the default time format so the SSR
and hydration passes agree. Inside a provider, every data and display prop
on a component becomes an optional override, and an explicit prop always
wins. Components still work fully from explicit props with no provider
anywhere.

Per-station components inside a provider find their station with the
shared [`resolveStation`
rule](/docs/station/client-data/#display-resolution--shared-across-bindings).
A component that resolves no station throws a wiring error instead of
rendering blank.

## Thresholds

Thresholds state their unit. `thresholds: { unit, values }` uses the
consumer's units (`{ unit: "kmh", values: [12, 20, 28] }`), and the package
converts them to the m/s wire unit once, internally, with `thresholdsToMps`
(exported from `@azohra/meteo.station` with the other unit conversions).
Chart guide labels print the numbers you declared. They do not print values
converted to m/s and back.
Inside a provider, `thresholds={null}` opts one component out of the provider's
grading (the shared
[trichotomy](/docs/station/client-data/#display-resolution--shared-across-bindings)).
Bands map to `meteo-band-0..n` classes, and
[you choose their colours](/docs/station/theming/#speed-bands-and-your-palette).

## Components

Wind-speed components convert to a display unit (`unit?: "kmh" | "knots" | "mph" | "mps"`,
default `"kmh"`). All components take `strings` for word overrides and i18n, and
components that print a timestamp also take `formatTime`.
Per-station components take `station` (or `stationId`); fleet components take `stations`.
Components render what the station's declared capabilities allow.
[What your hardware shows](/docs/station/what-your-hardware-shows/) maps
each capability to the parts it enables.

| Component | Props that matter |
|---|---|
| `StationCard` | The station card, a compound component (see below). `station`/`stationId`, `servedAt`, `receivedAtMs`, `thresholds`, `unit` |
| `CurrentConditions` | The instrument dial. Same props. Calm hides the needle, and outages grey the dial |
| `WindHistoryChart` | The lull–gust band and graded mean, with a persistent compass-letter row and Avg row above/below every vane. `thresholds` (guide labels show your declared numbers), `plotHeight`, `windowHours` (shows only the trailing N hours of the SAME points, with no new fetch), `compareOffsetDays` (`1 \| 2 \| 3`; overlays a prior day's trace shifted onto today's x-axis, absent when history doesn't reach back far enough), `nightShading` (grey sunset-to-sunrise columns from the station's own coordinates, absent without them). The full inspector: the pointer previews, a click pins by timestamp, and touch never previews. With `history` but fewer than two points, it shows the no-history words |
| `WindSampleStrip` | The live counterpart of the history chart. It draws the rolling sample window with the same frame, grid, compass-letter and avg rows, and edge-anchored ticks. It takes samples only: pass `samples` (from `useStationLive`) and `stationName`. Instants stay ungraded, a dropout breaks the trace, and a one-sample run draws as a dot. `plotHeight` |
| `TrendChart` | Temperature (°C) or sea-level pressure (hPa) over history. `series: "temperature" \| "pressure"`. Null gaps break the trace and are never interpolated. A series with fewer than two measured points says "not measured". No `unit`, because each series has its own unit |
| `WindRose` | Direction shares. `station`/`stationId` or raw `points`, `sectorCount`, `thresholds`, `favorableDirections`. No `unit`, because the rose shows percentages. With neither `points` nor history, it shows the no-history words |
| `DailyPattern` | A typical day. Every point is bucketed by time of day and vector-averaged. It shows a persistent compass-letter row, an Avg row (dashed for a slot no point fell into), and a coverage caption. `station`/`stationId` or raw `points`, `slotMinutes` (default 180), `utcOffsetMinutes`, `thresholds`, `favorableDirections` |
| `FavorableShare` | One stat, the share of non-calm history from a favorable direction. `station`/`stationId` or raw `points`, `favorableDirections`. It renders nothing without arcs. A calm-only history shows a calm note instead of 0% |
| `ClimatologyRose` | The [climatology cube](/docs/station/climatology/) as a stacked rose. Each wedge is split by the document's own thresholds, with coverage captions beneath (the favorable share when arcs are set, coverage only when unfiltered). `document` (from `useStationClimatology`), `months`, `slots`, `favorableDirections`, `stationName`. Without a document, it shows the no-climatology words |
| `ClimatologyDailyPattern` | The cube's typical day, drawn as a daily pattern and filtered by month on the client. `document`, `months`, `thresholds`, `favorableDirections`, `unit`, `plotHeight`, `stationName` |
| `StationTable` | One row per `stations` entry. Unavailable rows keep their geometry. `servedAt`, `receivedAtMs`, `stationMeta` (the sub-label under each name; the default is the source attribution, and you can render the sampling window, a distance, or anything else the station can report) |
| `StationStrip` | One station on one line: name, wind, lull/gust, FROM, temp, and updated time with freshness. `station`/`stationId`, `servedAt`, `receivedAtMs`. Absent values show a dash in place, a capability the station lacks omits its cell, and an unavailable station keeps the line with the reason in words |
| `AirMatrix` | Humidity through lightning behind a live disclosure. It shows columns only for conditions-capable `stations` |
| `FreshnessBadge` | A dot and a word, from `useFreshness` |
| `CompassFan` | The live compass. The newest sample is the solid needle, and every sample in the rolling window is a faint arrow in a fan, aged by tenth. A tight fan means a steady direction. `samples` (from `useStationLive`) or `station`/`stationId`, `favorableDirections` (verdict ring). Hidden without the `live` capability. An empty ring shows the no-samples words |
| `RecentSummaries` | The source's own step digests as panels. Each window shows average, gust, and lull, with one small arrow per step. `summaries` or `station`/`stationId`, `favorableDirections` (arrow verdicts), `unit`. Hidden without the `recentSummaries` capability. A declared block with no data shows a note about the absence |
| `AirExtremes` | Atmospheric tiles derived from served history: the last completed night's low (computed from real astronomy, so a station without coordinates gets no tile) and the pressure change over the trailing 3 h. `station`/`stationId`. It renders nothing when nothing can be derived |

`receivedAtMs` is `number | null` everywhere. Null means the feed is still
loading, and the freshness badge is not shown.

### Composing the station card

`StationCard` is a context provider. With no children it renders the full
card (header, instrument, chart, summary). With children, you choose which
pieces appear and in what order, without passing props to each one. The
trigger is `children === undefined`. Authored children that evaluate to `false` or
`null` (a `{cond && <X/>}` expression) still mean composition mode, so a
condition that becomes false never renders the whole default card by
surprise. Each piece also accepts explicit props that override the card's
context, so one chart can use its own thresholds. The pieces are available
as properties on the root and as flat named exports (`StationCardChart` and
the others), for toolchains that handle dot access across an RSC client
boundary badly. Rendering a piece outside `<StationCard>` throws.

```tsx
<StationCard stationId="launch" unit="knots">
  <StationCard.Header />
  <StationCard.Chart thresholds={{ unit: "knots", values: [6, 11, 15] }} />
  <StationCard.Summary />
</StationCard> {/* no instrument: the station table above already states the reading */}
```

### Favorable directions

`favorableDirections={[{ fromDeg: 260, toDeg: 340 }]}` takes degrees FROM.
Sectors may wrap through north: `fromDeg > toDeg` spans the north crossing.
It resolves like `thresholds`
([client data](/docs/station/client-data/#display-resolution--shared-across-bindings)).
Set it once on `StationFeedProvider` and every surface that shows direction
inherits it. Pass it on one component to override it there, or pass `null`
to opt one component out.

The rose and the dial draw a thin verdict ring, with favourable arcs in
`--meteo-wind-favorable` and the rest in `--meteo-wind-unfavorable`. The
history chart, daily pattern, and sample strip tint each vane by its own
direction. The `Direction` fragment tints its text and states the verdict,
and `FavorableShare` states the share as a number.
The verdict ring and the distribution petals are independent layers, and
neither changes the other. Calm samples get neither the favorable nor the
unfavorable class, since a calm reading has no direction.

## Primitives

Primitives are the smallest reading fragments, rendered as standalone inline
elements, for building your own layouts from pieces that match the package.
They follow the same display rules as the components. A value the station
cannot report is an em dash in place. A missing capability and an
unavailable station both show the same dash, and the layout never reflows
around missing data. Calm is shown as the calm word; a dash on a direction
is reserved for a dead vane on a windy reading. Displayed speeds are
converted to the display unit, and the wire value is kept, unrounded, in
m/s in the `value` attribute of the `<data>` element.

| Primitive | Renders |
|---|---|
| `Speed` / `Gust` / `Lull` | The converted integer and unit word in a `<data>`. Gust and lull show a dash without the `gustLull` capability |
| `Temperature` | One decimal with the degree word |
| `Pressure` | Sea-level pressure, one decimal hPa (needs the `conditions` capability) |
| `Direction` | Arrow glyph, compass point, and rounded degrees. Calm shows as a word, and a dead vane shows a dash. The aria sentence spells the point out (`compassSpoken` and `aria.direction` strings) |
| `UpdatedAt` | A relative age that updates as time passes ("just now", "3 min ago"; the `updated` strings group). Past about 6 hours it falls back to the absolute `formatTime` words. It is anchored to server time when `servedAt`/`receivedAtMs` exist |
| `BandChip` | The reading graded against `thresholds`, shown as a chip with `data-band`. Your `labels` (values.length + 1 words) name the bands. Without labels the chip shows the converted speed. Calm shows the calm word and is not graded |
| `Dial` | The instrument's gauge alone, `CurrentConditions` without flanks or rows. `size` scales the rendered box, never the drawing |
| `WindArrow` | The direction arrow glyph alone, pointing downwind for `deg` (degrees FROM). `size` (default 12). It is `aria-hidden`, so pair it with text |
| `Sparkline` | The served history window at word size: the lull–gust band and average trace, the big chart's dropout and null-pair rules, and `thresholds` grading per segment. A quiet station keeps the same fixed box |
| `Readout` | The charts' inspection line, an `<output>` with a bold lead (`strong`) and a `parts` tail of text and wind-arrow pieces. Pass `ariaLive` as polite at rest and off while a pointer previews, so a pin is announced and a sweep never floods a screen reader |

They fit inline in a sentence, a table cell, or a board row.

```tsx
<StationFeedProvider feed={feed} receivedAtMs={receivedAtMs} unit="knots">
  <p>
    <Speed /> <Direction />, gusting <Gust />, <UpdatedAt />
  </p>
</StationFeedProvider>
```

Primitives resolve from the provider and throw the wiring error by the rules
in [the provider](#the-provider). Every primitive still works without a
provider through explicit props.

## SSR and App Router

Every React module includes `"use client"`, so you can import them directly into an App Router
tree without wrapper files. Components render fully under `renderToString`, and the chart draws
after its first client-side measurement. Freshness is computed from `receivedAtMs`
instead of the wall clock, so server and client markup agree. The default time format reads
the runtime's locale lazily. Pass `locale` on `StationFeedProvider` (or your own
`formatTime`) when server and client locales may differ. To avoid a blank first paint
on the client, fetch the feed in a server component and seed the hook:

```tsx
const body = await fetch(FEED_URL).then((r) => r.text());
const feed = parseStationFeedJson(body); // from @azohra/meteo.station
// pass { feed, receivedAtMs: Date.now() } to useStation's / useStationFeed's initialData
```

## Board cells

For a compact per-station line on an overview board, use `StationStrip`. It
resolves its station like every other per-station component and includes
the dashes, capability gating, and freshness badge.

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

For a fully custom cell with your own markup and the library's data, combine
the root exports (`speedFromMps`, `speedUnitLabel`,
`stationFreshnessThresholds`) with `useStationFeed`, `useFreshness`, and
`FreshnessBadge`.
[The client data layer](/docs/station/client-data/#words-and-formatting)
lists every exported piece.

## Stability

The package is pre-1.0. The wire contract and environment helpers are
stable, and handler internals are not. Pin a minor version if you rely on
anything beyond them.
