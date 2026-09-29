---
title: Custom elements
description: "The station components as light-DOM custom elements, with registration, the provider element, attributes and properties, each tag's surface, card composition, and server HTML."
---

`@azohra/meteo.station/elements` provides the station surface as light-DOM
custom elements. It is a separate binding with the same standing as the
[React binding](/docs/station/react/), and it does not wrap it. Both
bindings render from the same shared core: the strings, formatting, display
resolution, and instrument geometry in `@azohra/meteo.station`, and the
polling stores in
[`@azohra/meteo.station/client`](/docs/station/client-data/). They emit the
same DOM under the same [stylesheet](/docs/station/theming/), and a parity
suite checks that the output is byte-identical.

## Registration

```html
<script type="module">
  import "@azohra/meteo.station/elements/register"; // defines every meteo-* tag
</script>
```

The binding needs no framework, but it still ships as npm ESM. The bare
specifier above needs a bundler, an import map, or a module-serving CDN to
resolve in a browser. A site with no build step serves the resolved module
and `styles.css` from its own assets, the same way it serves any other file.

Apps that need to control when tags are defined import the side-effect-free
index instead, with `import { defineMeteoElements } from "@azohra/meteo.station/elements"`.
The function is idempotent, defines providers before consumers, and accepts a
`CustomElementRegistry` for scoped-registry setups. Tag names are fixed,
because internal composition and the documented markup contract depend on
them.

Elements render in light DOM with no shadow roots, so the shipped skin and
your token overrides apply exactly as they do to the React components. Each
host element sets `display: contents` to remove its own box, so layout is
the same in both bindings.

## The provider element

`<meteo-station-feed>` owns the data layer and the display defaults for
every tag inside it, so those tags do not need to declare them again.

```html
<meteo-station-feed src="/api/wind" station="launch"
    unit="kmh" locale="en-CA" thresholds='{"unit":"kmh","values":[12,20,28]}'>
  <meteo-station-card></meteo-station-card>
  <meteo-station-table></meteo-station-table>
</meteo-station-feed>
```

- `src` is the MOUNT BASE. The element polls `${src}/feed` through the
  [client stores](/docs/station/client-data/). When `station` names an id,
  it also polls the light `${src}/current` and folds it in with the shared
  merge and clock rule. `poll-seconds` and `current-poll-seconds` override
  the cadence, `paused` stops the loops and keeps the held document, and
  `refresh()` fetches again immediately. There is no `live` attribute,
  because this binding polls only feed and current. To read the `/live`
  stream, use
  [`createStationLiveStore`](/docs/station/client-data/#the-live-store) or
  the React `useStationLive`.
- Without `src`, the consumer supplies the data by setting the `feed` and
  `receivedAtMs` properties.
- The display defaults `unit`, `locale`, and `thresholds` are attributes.
  `strings`, `formatTime`, `thresholds`, and `fetchInit` are properties.
- The element fires `meteo-feed` (`{ feed, receivedAtMs }`) each time the
  document advances and `meteo-error` (`{ error }`) for each structured poll
  error. The last structured error is also available as the `error`
  property.

## Attributes vs properties

Scalar values are attributes (`station-id`, `unit`, `served-at`,
`received-at-ms`, `width`, `series`, ...). Objects, arrays, and functions
are JS properties (`station`, `stations`, `feed`, `strings`, `formatTime`,
`thresholds`, `stationMeta`, `points`, `favorableDirections`, `labels`).
Properties assigned before registration are picked up on upgrade.

Every per-station tag accepts the same base set. It takes a `station-id`
attribute (or a `station` property holding the parsed object), `served-at`
and `received-at-ms` attributes for the freshness clocks, and `strings` and
`formatTime` properties for word and time-format overrides. All of these
are optional inside `<meteo-station-feed>`, which supplies them. The table
below lists only what each tag adds.

Thresholds follow the shared
[trichotomy](/docs/station/client-data/#display-resolution--shared-across-bindings)
with one syntax. An absent attribute (or unset property) means omitted,
`thresholds='{"unit":"kmh","values":[12,20,28]}'` is a value, and
`thresholds="none"` (or the property set to `null`) is the explicit opt-out.
Invalid JSON logs a warning and is treated as absent.

## The tags

The tags render only what the station's declared capabilities allow.
[What your hardware shows](/docs/station/what-your-hardware-shows/) has
the full map. Two React components have no tag. `Readout` is the charts'
internal inspection line, and the chart tags compose their own.
`WindSampleStrip` renders live samples, which reach this binding only
through
[`createStationLiveStore`](/docs/station/client-data/#the-live-store).
Every other component has a twin tag that renders identical DOM. What a
tag renders, including capability gating, calm, and absence behaviour, is
described in its twin's row under the React page's
[Components](/docs/station/react/#components) or
[Primitives](/docs/station/react/#primitives). The table below lists only
the binding surface.

| Tag | React twin | Attributes and properties |
|---|---|---|
| `<meteo-station-card>` | `StationCard` | `compose`, `thresholds`, `unit`. Authored children choose its pieces ([composition below](#composing-the-station-card)) |
| `<meteo-station-card-header>` `-instrument` `-chart` `-summary` | `StationCard.Header` et al. | Instrument and chart take their own `thresholds`/`unit` (chart also `plot-height`) over the card's context; all four take `strings`/`formatTime` properties. A part outside `<meteo-station-card>` throws |
| `<meteo-current-conditions>` | `CurrentConditions` | `thresholds`, `unit` |
| `<meteo-wind-history-chart>` | `WindHistoryChart` | `plot-height`, `window-hours`, `compare-offset-days` (`1\|2\|3`), `night-shading`, `thresholds`, `unit` |
| `<meteo-trend-chart>` | `TrendChart` | `series="temperature\|pressure"` required |
| `<meteo-wind-rose>` | `WindRose` | `sector-count` (default 16), `thresholds`, `favorable-directions` ([grammar below](#favorable-directions)); `points` property |
| `<meteo-daily-pattern>` | `DailyPattern` | `slot-minutes` (default 180), `utc-offset-minutes` (default 0; pass the station's fixed local offset), `plot-height`, `thresholds`, `unit`, `favorable-directions`; `points` property |
| `<meteo-favorable-share>` | `FavorableShare` | `favorable-directions`; `points` property |
| `<meteo-climatology-rose>` | `ClimatologyRose` | `months` / `slots` (JSON integer lists), `favorable-directions`, `station-name`; the `document` property carries the parsed cube |
| `<meteo-climatology-daily-pattern>` | `ClimatologyDailyPattern` | `months`, `plot-height`, `thresholds`, `unit`, `favorable-directions`, `station-name`; `document` property |
| `<meteo-station-table>` | `StationTable` | `unit`; `stations` property (defaults to the provider feed's), `stationMeta` property: `(station) => string \| Node \| null` |
| `<meteo-station-strip>` | `StationStrip` | `unit` |
| `<meteo-air-matrix>` | `AirMatrix` | `stations` property (defaults to the provider feed's). The element keeps its own open/closed disclosure state |
| `<meteo-freshness-badge>` | `FreshnessBadge` | `status="live\|aging\|stale"`; any other value renders nothing |
| `<meteo-compass-fan>` | `CompassFan` | `favorable-directions`; `samples` property (from the live store) |
| `<meteo-recent-summaries>` | `RecentSummaries` | `favorable-directions`, `unit`; `summaries` property |
| `<meteo-air-extremes>` | `AirExtremes` | `now-ms` (pins the clock, mainly for tests) |
| `<meteo-dial>` | `Dial` | `size` (scales the rendered box, never the drawing), `no-calm-word`, `thresholds`, `unit` |
| `<meteo-sparkline>` | `Sparkline` | `width`, `height`, `no-band`, `thresholds` |
| `<meteo-wind-arrow>` | `WindArrow` | `deg` (degrees FROM, default 0), `size` (default 12). It is `aria-hidden`, so pair it with text |

A tag that resolves no station throws an error that names
`<meteo-station-feed>`. The resolution order follows the client data
layer's
[display-resolution rules](/docs/station/client-data/#display-resolution--shared-across-bindings).

### Text atoms

Text atoms are inline tags that place a reading inside your own markup,
such as a table cell, a caption, or one line of a board.

```html
<meteo-station-feed src="/api/wind" unit="knots">
  <p>
    <meteo-speed></meteo-speed> <meteo-direction></meteo-direction>,
    gusting <meteo-gust></meteo-gust>, <meteo-updated-at></meteo-updated-at>
  </p>
</meteo-station-feed>
```

Each atom is the tag twin of the React
[primitive](/docs/station/react/#primitives) with the same name. The atoms
are `<meteo-speed>`, `<meteo-gust>`, and `<meteo-lull>` (`unit` attribute),
`<meteo-temperature>`, `<meteo-pressure>`, `<meteo-direction>`,
`<meteo-updated-at>` (anchored to server time by `served-at` and
`received-at-ms`, or by the provider feed), and `<meteo-band-chip>` (a
`labels` property). The atoms follow the primitives' display rules. A value
the station cannot report is an em dash in place, never a zero, and calm is
shown as the calm word.

### Favorable directions

The React page's
[Favorable directions](/docs/station/react/#favorable-directions) section
covers how the setting resolves, the absence of a package default, and
where the verdict shows. The `favorable-directions` attribute takes the
same JSON on any tag that shows direction, and `"none"` opts out. The
`favorableDirections` property holds the parsed array.

<!-- meteo-doc-fence: ignore — a page fragment; the package declares no tag-name map for querySelector -->
```js
document.querySelector("meteo-station-feed").favorableDirections =
  [{ fromDeg: 260, toDeg: 340 }]; // degrees FROM; sectors may wrap through north
```

A calm sample gets neither the favorable nor the unfavorable class,
because calm has no direction.

## Composing the station card

With no authored content, `<meteo-station-card>` renders the full
default card. Any authored child (an element, or non-whitespace text)
switches it to composition mode, where your pieces move into the card and
only they appear. The element reads the choice once, at first render. The
`compose` attribute forces composition mode even when the card is empty,
so markup generated one child at a time gets an empty card and never the
default one.

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

Elements render light DOM on the client. They use no declarative shadow
DOM and no hydration. Server HTML may contain the tags. They do nothing
until `defineMeteoElements()` runs, and then each one renders itself on
upgrade and replaces any existing children, so those children can serve as
a static skeleton. The exception is `<meteo-station-card>`, where authored
children switch on composition mode.
Pages that need server-rendered, hydrated markup use the
[React binding](/docs/station/react/#ssr-and-app-router). The two bindings
share every visual and semantic rule, so pages that use different bindings
stay consistent.

## Stability

The package is pre-1.0. The tag names, the attributes and properties, and
the emitted class vocabulary are stable. Pin a minor version if you rely on
anything beyond them.
