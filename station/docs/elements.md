---
title: Custom elements
description: The station surface as light-DOM custom elements — registration, the provider element, attributes vs properties, composition, and server HTML.
---

`@azohra/meteo.station/elements`: the station surface as light-DOM custom
elements — a full peer of the [react binding](/docs/station/react/), not a
wrapper around it. Both bindings render from the same shared core (the
strings, formatting, display-resolution, and instrument geometry on
`@azohra/meteo.station`; the polling stores on
[`@azohra/meteo.station/client`](/docs/station/client-data/)) and emit the
same DOM under the same [stylesheet](/docs/station/theming/) — a parity
suite holds them byte-identical, so neither is "the reference".

## Registration

```html
<script type="module">
  import "@azohra/meteo.station/elements/register"; // defines every meteo-* tag
</script>
```

Apps that need control over timing import the side-effect-free index
instead: `import { defineMeteoElements } from "@azohra/meteo.station/elements"`
— it is idempotent, defines providers before consumers, and accepts a
`CustomElementRegistry` for scoped-registry setups. Tag names are fixed:
internal composition and the documented markup contract depend on them.

Elements render in light DOM (no shadow roots), so the shipped skin and
your token overrides apply exactly as they do to the react components; each
host erases its own box with `display: contents`, so layout cannot tell the
bindings apart.

## The provider element

`<meteo-station-feed>` is the ambient default the react
`StationFeedProvider` is — plus the data layer the hooks are over there:

```html
<meteo-station-feed src="/api/wind" station="launch"
    unit="kmh" locale="en-CA" thresholds='{"unit":"kmh","values":[12,20,28]}'>
  <meteo-station-card></meteo-station-card>
  <meteo-station-table></meteo-station-table>
</meteo-station-feed>
```

- `src` is the MOUNT BASE; the element polls `${src}/feed` (and, when
  `station` names an id, the light `${src}/current` — folded in with the
  shared merge and clock rule) via the
  [client stores](/docs/station/client-data/). `poll-seconds` /
  `current-poll-seconds` override cadence, `paused` stops the loops without
  dropping the held document, and `refresh()` refetches now.
- Without `src`, the consumer owns the data: set the `feed` and
  `receivedAtMs` properties.
- Display defaults: `unit`, `locale`, `thresholds` as attributes; `strings`,
  `formatTime`, `thresholds`, `fetchInit` as properties.
- Events: `meteo-feed` (`{ feed, receivedAtMs }`) per advanced document and
  `meteo-error` (`{ error }`) per structured poll error.

## Attributes vs properties

Scalars ride attributes (`station-id`, `unit`, `served-at`,
`received-at-ms`, `width`, `series`, …); rich values ride JS properties
(`station`, `stations`, `feed`, `strings`, `formatTime`, `thresholds`,
`stationMeta`, `points`, `favorableDirections`, `labels`). Properties
assigned before registration are captured on upgrade.

**Thresholds** speak one grammar everywhere, preserving the shared
[trichotomy](/docs/station/client-data/#display-resolution--shared-across-bindings):
attribute absent (or property unset) inherits the ambient thresholds;
`thresholds='{"unit":"kmh","values":[12,20,28]}'` grades against exactly
these; `thresholds="none"` (or property `null`) explicitly opts out.
Invalid JSON warns and reads as absent.

## Elements

Every react component has its tag twin, rendering the identical DOM:

| Tag | React twin | Notes |
|---|---|---|
| `<meteo-station-card>` | `StationCard` | Compound — below |
| `<meteo-current-conditions>` | `CurrentConditions` | |
| `<meteo-wind-history-chart>` | `WindHistoryChart` | `plot-height`, `window-hours`, `compare-offset-days` (`1\|2\|3`, absent when history doesn't reach back that far); the full inspector (preview, pin by timestamp, touch-safe); a persistent compass-letter row and Avg row above/below every vane |
| `<meteo-trend-chart>` | `TrendChart` | `series="temperature|pressure"` required |
| `<meteo-wind-rose>` | `WindRose` | `sector-count`; `points` / `favorableDirections` properties |
| `<meteo-daily-pattern>` | `DailyPattern` | `slot-minutes`, `utc-offset-minutes`; `points` property; a persistent compass-letter row and Avg row (dashed for a void slot) |
| `<meteo-station-table>` | `StationTable` | `stationMeta` property: `(station) => string \| Node \| null` |
| `<meteo-station-strip>` | `StationStrip` | |
| `<meteo-air-matrix>` | `AirMatrix` | Disclosure state is the element's own |
| `<meteo-freshness-badge>` | `FreshnessBadge` | `status="live|aging|stale"` |
| `<meteo-dial>` | `Dial` | `size`, `no-calm-word` |
| `<meteo-sparkline>` | `Sparkline` | `width`, `height`, `no-band` |
| `<meteo-wind-arrow>` | `WindArrow` | `deg`, `size` |
| `<meteo-speed>` `-gust` `-lull` `-temperature` `-pressure` `-direction` `-updated-at` `-band-chip` | the text atoms | Inline, provider-resolvable, absence stays absent |

Station resolution and the wiring error are the shared rules: explicit
`station` property → `station-id` in the ambient feed → `primaryStationId`
→ first station; resolving nothing throws, naming `<meteo-station-feed>`.

## Composing the station card

`<meteo-station-card>` mirrors the react compound: with **no authored
children** it renders the full default card; any authored child means
composition mode — your pieces move into the card and only they appear.
The `compose` attribute is the markup stand-in for react's
authored-but-empty edge (an empty card, never a surprise default).

```html
<meteo-station-card station-id="launch">
  <meteo-station-card-header></meteo-station-card-header>
  <meteo-station-card-chart thresholds='{"unit":"knots","values":[6,11,15]}'></meteo-station-card-chart>
  <meteo-station-card-summary></meteo-station-card-summary>
</meteo-station-card>
```

Each part accepts its own `thresholds`/`unit` attributes and
`strings`/`formatTime` properties over the card's context; a part outside
`<meteo-station-card>` throws.

## Client rendering and server HTML

Elements are client-rendered light DOM — there is no declarative shadow DOM
and no hydration. Server HTML may contain the tags; they are inert until
`defineMeteoElements()` runs, then render themselves on upgrade, REPLACING
any pre-existing children (usable as a static skeleton) — except
`<meteo-station-card>`, where authored children are the composition signal.
Pages that need server-rendered, hydrated markup use the
[react binding](/docs/station/react/#ssr-and-app-router); the two share
every visual and semantic rule, so mixing them across pages cannot drift.

## Stability

Pre-1.0: tag names, the attribute/property surface, and the emitted class
vocabulary documented here are stable; pin a minor version if you reach
past them.
