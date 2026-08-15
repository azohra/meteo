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
suite holds them byte-identical, so neither is "the reference".

## Registration

```html
<script type="module">
  import "@azohra/meteo.station/elements/register"; // defines every meteo-* tag
</script>
```

The binding removes the framework, not the packaging: it ships as npm ESM,
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

**Thresholds** speak one grammar everywhere, preserving the shared
[trichotomy](/docs/station/client-data/#display-resolution--shared-across-bindings):
attribute absent (or property unset) inherits the ambient thresholds;
`thresholds='{"unit":"kmh","values":[12,20,28]}'` grades against exactly
these; `thresholds="none"` (or property `null`) explicitly opts out.
Invalid JSON warns and reads as absent.

## The tags

The tags believe the station's declared capabilities: a station without
`history` gets **no chart at all** (the history and trend tags render
nothing, not an empty frame), a station without `conditions` contributes no
air-matrix column, and gust/lull cells dash without `gustLull` —
[What your hardware shows](/docs/station/what-your-hardware-shows/) is the
full capability-to-surface map. Two react components have no tag: `Readout`
(the charts' internal inspection line — the chart tags compose their own)
and `WindSampleStrip` (it renders live samples, which reach this binding
only through
[`createStationLiveStore`](/docs/station/client-data/#the-live-store)).
Everything else has a twin rendering the identical DOM.

| Tag | Renders | Attributes, properties, behaviour |
|---|---|---|
| `<meteo-station-card>` | The full station card: header, instrument, chart, summary | `compose`, `thresholds`, `unit`. A compound — authored children pick its pieces ([composition below](#composing-the-station-card)). Without `history` the chart slot is simply absent |
| `<meteo-station-card-header>` `-instrument` `-chart` `-summary` | The card's composable pieces | Instrument and chart take their own `thresholds`/`unit` (chart also `plot-height`) over the card's context; all four take `strings`/`formatTime` properties. A part outside `<meteo-station-card>` throws |
| `<meteo-current-conditions>` | The instrument dial with lull and gust flanks | `thresholds`, `unit`. Calm hides the needle; an unavailable station greys the dial, reason in words |
| `<meteo-wind-history-chart>` | Lull-gust band + graded mean over served history, with a persistent compass-letter row and Avg row above/below every vane | `plot-height`; `window-hours` slices the trailing N hours of the SAME points, no new fetch; `compare-offset-days` (`1\|2\|3`) overlays a prior day's trace shifted onto today's own x-axis, absent when history doesn't reach back that far; `thresholds` (guide labels print your declared numbers), `unit`. The full inspector: pointer preview, click pins by timestamp, touch never previews. Renders nothing without the `history` capability; with it but under two points, the no-history words |
| `<meteo-trend-chart>` | Temperature (°C) or sea-level pressure (hPa) over history | `series="temperature\|pressure"` required. Null gaps break the trace, never interpolated; a series under two measured points says "not measured". No `unit`: the units are the series' own. Nothing without `history` |
| `<meteo-wind-rose>` | Direction shares as petals, percentages not speeds | `sector-count` (default 16), `thresholds`; `points` / `favorableDirections` properties ([the judgment ring](#the-roses-judgment-ring)). No `unit`. With neither `points` nor station history, the no-history words |
| `<meteo-daily-pattern>` | A typical day: every point bucketed by time-of-day and vector-averaged, with the persistent compass-letter and Avg rows (Avg dashes for a slot nothing ever fell into) and a coverage caption | `slot-minutes` (default 180), `utc-offset-minutes` (default 0 — pass the station's fixed local offset), `plot-height`, `thresholds`, `unit`; `points` property to aggregate your own slice |
| `<meteo-station-table>` | One row per station; unavailable rows keep their geometry, reason in words | `unit`; `stations` property (defaults to the ambient feed's), `stationMeta` property: `(station) => string \| Node \| null`, the sub-label under each name (default: the source attribution) |
| `<meteo-station-strip>` | One station on one line: name, wind, lull/gust, FROM, temp, updated + freshness | `unit`. Absent values dash in place; a capability the station lacks omits its cell; an unavailable station keeps the line |
| `<meteo-air-matrix>` | Humidity through lightning behind a live disclosure | `stations` property (defaults to the ambient feed's). Columns only for `conditions`-capable stations; the open/closed disclosure state is the element's own |
| `<meteo-freshness-badge>` | A dot and a word | `status="live\|aging\|stale"`; any other value renders nothing |
| `<meteo-dial>` | The instrument's gauge alone: `<meteo-current-conditions>` without flanks or rows | `size` (scales the rendered box, never the drawing), `no-calm-word`, `thresholds`, `unit` |
| `<meteo-sparkline>` | The served history window at word size: lull-gust band + average trace, the big chart's dropout and null-pair rules | `width`, `height`, `no-band`, `thresholds` (grades per segment). Needs two history points; a quiet station holds the same fixed box |
| `<meteo-wind-arrow>` | The direction arrow glyph alone, pointing downwind | `deg` (degrees FROM, default 0), `size` (default 12). `aria-hidden`; pair it with text |

Station resolution and the wiring error are the shared rules: explicit
`station` property → `station-id` in the ambient feed → `primaryStationId`
→ first station; resolving nothing throws, naming `<meteo-station-feed>`.

### Text atoms

The smallest reading fragments as inline tags, for composing your own
layouts — a sentence, a table cell, a board row — out of package-consistent
pieces:

```html
<meteo-station-feed src="/api/wind" unit="knots">
  <p>
    <meteo-speed></meteo-speed> <meteo-direction></meteo-direction>,
    gusting <meteo-gust></meteo-gust>, <meteo-updated-at></meteo-updated-at>
  </p>
</meteo-station-feed>
```

| Tag | Renders |
|---|---|
| `<meteo-speed>` / `<meteo-gust>` / `<meteo-lull>` | The converted integer + unit word in a `<data>` element (`unit` attribute); gust and lull dash without the `gustLull` capability |
| `<meteo-temperature>` | One decimal with the degree word |
| `<meteo-pressure>` | Sea-level pressure, one decimal hPa (needs the `conditions` capability) |
| `<meteo-direction>` | Arrow glyph + compass point + rounded degrees; calm in a word, dead vane dashes. The aria sentence spells the point out |
| `<meteo-updated-at>` | Ticking relative age ("just now", "3 min ago"), falling back to the absolute time words past ~6 hours; server-anchored when `served-at`/`received-at-ms` (or the ambient feed) exist |
| `<meteo-band-chip>` | The reading graded against `thresholds`, worn as a chip with `data-band`. A `labels` property (values.length + 1 words) supplies the vocabulary; without labels the chip states the converted speed. Calm says the calm word, ungraded |

The atoms hold the display discipline the composed tags do: a value the
station cannot report is an em dash **in place** (a lacking capability and
an unavailable station earn the same dash — the layout never reflows around
missing data); calm is said in the calm word (the dash on a direction is
reserved for a dead vane on a blowing reading); shown speeds convert to the
display unit while the wire value rides the `<data>` element's `value`
attribute in m/s, unrounded.

### The rose's judgment ring

Set the `favorableDirections` property to draw a thin judgment ring outside
the rose's grid:

```js
document.querySelector("meteo-wind-rose").favorableDirections =
  [{ fromDeg: 260, toDeg: 340 }]; // degrees FROM; sectors may wrap through north
```

Favourable arcs paint in `--meteo-wind-favorable`, the remainder in
`--meteo-wind-unfavorable`
([the tokens are yours](/docs/station/theming/#token-reference)). The ring
judges direction, the petals report distribution; the two never mix.

## Composing the station card

With **no authored content** `<meteo-station-card>` renders the full
default card; any authored child (an element, or non-whitespace text) means
composition mode: your pieces move into the card and only they appear. The
choice is read once, when the element first renders. The `compose`
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

Elements are client-rendered light DOM: there is no declarative shadow DOM
and no hydration. Server HTML may contain the tags; they are inert until
`defineMeteoElements()` runs, then render themselves on upgrade, REPLACING
any pre-existing children (usable as a static skeleton), except
`<meteo-station-card>`, where authored children are the composition signal.
Pages that need server-rendered, hydrated markup use the
[react binding](/docs/station/react/#ssr-and-app-router); the two share
every visual and semantic rule, so mixing them across pages cannot drift.

## Stability

Pre-1.0: the tag names, the attribute/property surface, and the emitted
class vocabulary are stable; pin a minor version if you reach past them.
