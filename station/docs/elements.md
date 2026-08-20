---
title: Custom elements
description: "The station surface as light-DOM custom elements: registration, the provider element, attributes vs properties, every tag's surface, composition, and server HTML."
---

`@azohra/meteo.station/elements`: the station surface as light-DOM custom
elements, a full peer of the [react binding](/docs/station/react/), not a
wrapper around it. Both bindings render from the same shared core (the
strings, formatting, display-resolution, and instrument geometry on
`@azohra/meteo.station`; the polling stores on
[`@azohra/meteo.station/client`](/docs/station/client-data/)) and emit the
same DOM under the same [stylesheet](/docs/station/theming/); a parity
suite holds them byte-identical.

## Registration

```html
<script type="module">
  import "@azohra/meteo.station/elements/register"; // defines every meteo-* tag
</script>
```

The binding removes the framework but keeps the packaging: it ships as npm ESM,
so the bare specifier above still needs a bundler, an import map, or a
module-serving CDN to resolve in a browser. A site with no build step
serves the resolved module and `styles.css` from its own assets however it
serves any other file.

Apps that need control over timing import the side-effect-free index
instead: `import { defineMeteoElements } from "@azohra/meteo.station/elements"`.
It is idempotent, defines providers before consumers, and accepts a
`CustomElementRegistry` for scoped-registry setups. Tag names are fixed:
internal composition and the documented markup contract depend on them.

Elements render in light DOM (no shadow roots), so the shipped skin and
your token overrides apply exactly as they do to the react components; each
host erases its own box with `display: contents`, so layout cannot tell the
bindings apart.

## The provider element

`<meteo-station-feed>` owns the data layer and the ambient display
defaults; every tag inside it renders without re-declaring them:

```html
<meteo-station-feed src="/api/wind" station="launch"
    unit="kmh" locale="en-CA" thresholds='{"unit":"kmh","values":[12,20,28]}'>
  <meteo-station-card></meteo-station-card>
  <meteo-station-table></meteo-station-table>
</meteo-station-feed>
```

- `src` is the MOUNT BASE; the element polls `${src}/feed` (and, when
  `station` names an id, the light `${src}/current`, folded in with the
  shared merge and clock rule) via the
  [client stores](/docs/station/client-data/). `poll-seconds` /
  `current-poll-seconds` override cadence, `paused` stops the loops without
  dropping the held document, and `refresh()` refetches now. There is no
  `live` attribute: this binding polls feed and current only; the `/live`
  stream is reached through
  [`createStationLiveStore`](/docs/station/client-data/#the-live-store) or
  the react `useStationLive`.
- Without `src`, the consumer owns the data: set the `feed` and
  `receivedAtMs` properties.
- Display defaults: `unit`, `locale`, `thresholds` as attributes; `strings`,
  `formatTime`, `thresholds`, `fetchInit` as properties.
- Events: `meteo-feed` (`{ feed, receivedAtMs }`) per advanced document and
  `meteo-error` (`{ error }`) per structured poll error; the last structured
  error is also readable as the `error` property.

## Attributes vs properties

Scalars ride attributes (`station-id`, `unit`, `served-at`,
`received-at-ms`, `width`, `series`, ...); rich values ride JS properties
(`station`, `stations`, `feed`, `strings`, `formatTime`, `thresholds`,
`stationMeta`, `points`, `favorableDirections`, `labels`). Properties
assigned before registration are captured on upgrade.

Every per-station tag shares one base surface: a `station-id` attribute (or
a `station` property carrying the parsed object), `served-at` /
`received-at-ms` attributes for the freshness clocks, and `strings` /
`formatTime` properties for word and time-format overrides — all optional
inside `<meteo-station-feed>`, which supplies them ambiently. The rows
below list only what each tag adds.

**Thresholds** follow the shared
[trichotomy](/docs/station/client-data/#display-resolution--shared-across-bindings)
in one grammar: attribute absent (or property unset) is omitted,
`thresholds='{"unit":"kmh","values":[12,20,28]}'` is a value, and
`thresholds="none"` (or property `null`) is the explicit opt-out.
Invalid JSON warns and reads as absent.

## The tags

The tags render only what the station's declared capabilities allow;
[What your hardware shows](/docs/station/what-your-hardware-shows/) has
the full map. Two react components have no tag: `Readout`
(the charts' internal inspection line — the chart tags compose their own)
and `WindSampleStrip` (it renders live samples, which reach this binding
only through
[`createStationLiveStore`](/docs/station/client-data/#the-live-store)).
Everything else has a twin rendering the identical DOM, and what a tag
renders — capability gating, calm, and absence behaviour included — is its
twin's row under the react page's
[Components](/docs/station/react/#components) or
[Primitives](/docs/station/react/#primitives). The rows below carry only
the binding surface.

| Tag | React twin | Attributes and properties |
|---|---|---|
| `<meteo-station-card>` | `StationCard` | `compose`, `thresholds`, `unit`. Authored children pick its pieces ([composition below](#composing-the-station-card)) |
| `<meteo-station-card-header>` `-instrument` `-chart` `-summary` | `StationCard.Header` et al. | Instrument and chart take their own `thresholds`/`unit` (chart also `plot-height`) over the card's context; all four take `strings`/`formatTime` properties. A part outside `<meteo-station-card>` throws |
| `<meteo-current-conditions>` | `CurrentConditions` | `thresholds`, `unit` |
| `<meteo-wind-history-chart>` | `WindHistoryChart` | `plot-height`, `window-hours`, `compare-offset-days` (`1\|2\|3`), `night-shading`, `thresholds`, `unit` |
| `<meteo-trend-chart>` | `TrendChart` | `series="temperature\|pressure"` required |
| `<meteo-wind-rose>` | `WindRose` | `sector-count` (default 16), `thresholds`, `favorable-directions` ([grammar below](#favorable-directions)); `points` property |
| `<meteo-daily-pattern>` | `DailyPattern` | `slot-minutes` (default 180), `utc-offset-minutes` (default 0 — pass the station's fixed local offset), `plot-height`, `thresholds`, `unit`, `favorable-directions`; `points` property |
| `<meteo-favorable-share>` | `FavorableShare` | `favorable-directions`; `points` property |
| `<meteo-climatology-rose>` | `ClimatologyRose` | `months` / `slots` (JSON integer lists), `favorable-directions`, `station-name`; the `document` property carries the parsed cube |
| `<meteo-climatology-daily-pattern>` | `ClimatologyDailyPattern` | `months`, `plot-height`, `thresholds`, `unit`, `favorable-directions`, `station-name`; `document` property |
| `<meteo-station-table>` | `StationTable` | `unit`; `stations` property (defaults to the ambient feed's), `stationMeta` property: `(station) => string \| Node \| null` |
| `<meteo-station-strip>` | `StationStrip` | `unit` |
| `<meteo-air-matrix>` | `AirMatrix` | `stations` property (defaults to the ambient feed's); the open/closed disclosure state is the element's own |
| `<meteo-freshness-badge>` | `FreshnessBadge` | `status="live\|aging\|stale"`; any other value renders nothing |
| `<meteo-compass-fan>` | `CompassFan` | `favorable-directions`; `samples` property (from the live store) |
| `<meteo-recent-summaries>` | `RecentSummaries` | `favorable-directions`, `unit`; `summaries` property |
| `<meteo-air-extremes>` | `AirExtremes` | `now-ms` (pins the clock, mainly for tests) |
| `<meteo-dial>` | `Dial` | `size` (scales the rendered box, never the drawing), `no-calm-word`, `thresholds`, `unit` |
| `<meteo-sparkline>` | `Sparkline` | `width`, `height`, `no-band`, `thresholds` |
| `<meteo-wind-arrow>` | `WindArrow` | `deg` (degrees FROM, default 0), `size` (default 12). `aria-hidden`; pair it with text |

A tag that resolves no station throws, naming `<meteo-station-feed>`; the
resolution chain is client-data's
[display-resolution rules](/docs/station/client-data/#display-resolution--shared-across-bindings).

### Text atoms

Inline tags for placing a reading inside your own markup — a table cell,
a caption, one line of a board:

```html
<meteo-station-feed src="/api/wind" unit="knots">
  <p>
    <meteo-speed></meteo-speed> <meteo-direction></meteo-direction>,
    gusting <meteo-gust></meteo-gust>, <meteo-updated-at></meteo-updated-at>
  </p>
</meteo-station-feed>
```

Each atom is the tag twin of the react
[primitive](/docs/station/react/#primitives) of the same name:
`<meteo-speed>` / `<meteo-gust>` / `<meteo-lull>` (`unit` attribute),
`<meteo-temperature>`, `<meteo-pressure>`, `<meteo-direction>`,
`<meteo-updated-at>` (server-anchored by `served-at` / `received-at-ms`, or
the ambient feed), and `<meteo-band-chip>` (a `labels` property). The atoms
hold the primitives' display discipline: an unreportable value is an em
dash in place, never a zero, and calm is said in the calm word.

### Favorable directions

The semantics — resolution, no package default, and where the verdict
shows — are the react page's
[Favorable directions](/docs/station/react/#favorable-directions). The
`favorable-directions` attribute takes the same JSON on any
direction-bearing tag (`"none"` opts out); the `favorableDirections`
property carries the parsed array:

```js
document.querySelector("meteo-station-feed").favorableDirections =
  [{ fromDeg: 260, toDeg: 340 }]; // degrees FROM; sectors may wrap through north
```

A calm sample gets neither the favorable nor the unfavorable class,
because calm has no direction.

## Composing the station card

With no authored content `<meteo-station-card>` renders the full
default card; any authored child (an element, or non-whitespace text) means
composition mode: your pieces move into the card and only they appear. The
element reads the choice once, at first render. The `compose`
attribute forces composition mode even with nothing inside — an empty card,
never a surprise default — for markup generated child-by-child.

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

Elements are client-rendered light DOM: no declarative shadow DOM, no
hydration. Server HTML may contain the tags; they are inert until
`defineMeteoElements()` runs, then render themselves on upgrade, replacing
any pre-existing children (usable as a static skeleton), except
`<meteo-station-card>`, where authored children are the composition signal.
Pages that need server-rendered, hydrated markup use the
[react binding](/docs/station/react/#ssr-and-app-router); the two share
every visual and semantic rule, so mixing them across pages cannot drift.

## Stability

Pre-1.0: the tag names, the attribute/property surface, and the emitted
class vocabulary are stable; pin a minor version if you reach past them.
