---
title: Build a scene graph
description: Produce serializable geometry and hit-testing from one validated profile.
---

`buildMeteogramScene(profile, options)` converts a validated document into pure data:
scales, ticks, strips, sampled fields, line and band paths, wind barbs, labels,
markers, and interaction readings. It touches no DOM and contains no functions,
so it can cross a worker boundary or be serialized for inspection.

![A rendered Meteogram with outlined regions naming the MeteogramScene collections that draw them: the time–height plot (fields, series, barbs, markers), the altitude axes, the hour-label and surface-temperature row, the metric strips, the launch line, and the selected-hour column.](figures/scene-anatomy.svg)

```ts title="build-scene.ts"
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { buildMeteogramScene, cursorReading } from "@azohra/meteo.briefing/meteogram";

export function sceneAndFirstReading(profile: SiteForecast, olderProfileTimeZone?: string) {
  const timeZone = profile.site.timeZone ?? olderProfileTimeZone;
  if (!timeZone) throw new Error("older profile needs an explicit IANA timezone");
  const scene = buildMeteogramScene(profile, {
    timeZone,
    // The caller picks the launch: here the sample's Test Hill pick
    // from site-context.json. Omit it and no launch marker draws.
    launch: { name: "Test Hill", elevationM: 1225.1 },
    hours: profile.hours.slice(0, 8),
    overlays: { thermalIndex: true, windShear: true },
    widthPx: 900,
    plotHeightPx: 380,
    hourLabel: "12h",
    barbStride: "auto",
    markerStride: {
      cloudBase: { every: 2 },
      usableLiftTop: { every: 2 },
    },
    stripLabels: { thermalStrength: "LIFT" },
  });

  const reading = cursorReading(
    scene,
    scene.scales.plotLeft + 5,
    scene.scales.plotTop + 5,
  );
  return { scene, reading };
}
```

## Supply the launch

Documents are launch-agnostic samples: a profile records where the atmosphere
was sampled and what the model thinks the ground there is
(`site.modelElevationM`); it carries no launch elevation, because one grid
sample serves every launch its cell covers. The launch is a render input:

- `launch: { elevationM }` draws the launch line at that elevation, labelled
  `launch <n> m`; add `name` and the label becomes `<name> <n> m`. The number
  is the consumer's, typically the `elevation` pick from
  [site-context.json](/docs/briefing/site-context-document/).
- No `launch` option → `scene.launch` is null and no marker draws. That
  absence means the document never knew a launch; it is not an error.
- The `launch` **overlay** keeps its meaning as a display toggle: off, it
  hides even a provided launch.

## Select hours explicitly

Options accept one of three equivalent forms:

- `hourIndices`: indices into `profile.hours`; this wins when both forms exist;
- `hours`: hour objects matched back by `validAt`; or
- `hours: { timeZone, dateKey }`: one local calendar day.

Absent a selection, the scene includes every profile hour. `buildMeteogramScene`
requires an explicit timezone for labels and accessible descriptions. Pass
`profile.site.timeZone` when present or a caller-owned fallback for an older
profile; the package does not infer a zone from a site name or coordinate.

## Configure presentation

`MeteogramOptions` controls overlays, 1-2-1 display smoothing, CAPE class
thresholds (`capeClasses`, defaulting to the exported
`DEFAULT_CAPE_CLASSES`), a parameterized sink rate, chart geometry, hour
labels, barbs, line markers, and strip labels. Every drawn data layer except the axes and
frame has an overlay toggle. The `surfaceTemperature` overlay defaults on and
adds one rounded `<n>°` readout per hour below the hour labels. Unavailable
fields add no marks; the scene never pads them with zero.

## Draw smoke, and the adjusted view

Pass a site's smoke document as `options.smoke` and the smoke strip
draws wherever the profile itself publishes no smoke: one source per
strip, never a blend, with `scene.smokeSource` naming the model and run
that fed the pixels. Set `options.smokeAdjusted: true` to build the
smoke-adjusted alternate view: every hour's w* derated by the
slant-path transmittance and the usable-lift envelope re-derived, one
coherent scene. The graph then carries `scene.smokeAdjustment` (smoke
model + run): render that label; the reference key does it for
you via `KeySpec.smokeAdjusted`. The option quietly no-ops, and
`smokeAdjustment` stays null, when there is no smoke data or the
profile's own fluxes are already smoke-aware
(`semantics.smoke: "radiativelyCoupled"`). Pointer packets from
`cursorReading` include the drawn hour's `smokeSurfaceUgm3` and
`smokeAot`, so tooltips read the same numbers the pixels drew.

## Draw measurements beside the forecast

Pass a site's observation document as `options.observations` and the
Sun strip draws: satellite-measured W/m² at the product's own cadence
(every sample inside the window, where its instant falls), with a
shadow behind the line that deepens as the measured sky under-delivers
against the clear-sky expectation (tint = 1 − observed transmittance).
A measured line stops at its data: it never extends to the plot edges
the way a forecast strip does, a gap wider than
`measurementGapMinutes` (TRIAL default 45) breaks it rather than
interpolating across a retrieval outage, and a lone surviving sample
draws as a dot (`MetricStrip.dots`) instead of vanishing. The window's
remainder past the newest measured instant is not a gap: a pending
tint fills from `MetricStrip.measuredToX` to the right edge. Entries
labelled with a nonzero `quality` (DSR's binary DQF-1
"degraded/invalid" state, the sunrise and sunset shoulders) never join
the line: they draw as dimmed dots (`MetricStrip.degradedDots`),
indicative rather than quantitative, and they never shade the dimming
cells, because a ratio built on a provider-refused measurement would
draw a shadow the data cannot support. `scene.observationSource` names
the dataset and its newest measured instant: the strip is another
source with its own cadence, and renderers must be able to label it;
the reference key explains the shadow via `KeySpec.measuredDimming`.
The shadow cells, pointer packets, and the sampling row remain hourly
joins by nearest instant: per-hour consumers read the hour's nearest
measurement, the line reads them all. Pointer packets carry
`observedIrradianceWm2`, `observedIrradianceQuality`, and
`observedTransmittance`, so an inspector reads the measurement and its
grade where the pixels drew it.

Pass an AOD observation document as `options.aotObservations` and the
AOT strip draws beside it: satellite-measured aerosol optical
thickness at 550 nm (the same quantity, wavelength, and field name the
profile's per-hour `smoke` block forecasts as `aot`), drawn at the
product's own cadence under the same rules as the Sun strip (gaps
break the line, lone retrievals draw as dots, the not-yet-measured
remainder renders pending), with `scene.aotObservationSource` naming
the dataset and its newest measured instant. The haze behind the line
is the forecast smoke strip's own cell encoding, same
class and same scale (full tint at AOT 3), and one key chip,
`KeySpec.smokeHaze`,
explains both tints. Unlike the Sun strip, a `quality: 1` AOT entry
joins the line: AOD's graded DQF ≤ 1 is the smoke literature's
validated top-two set, so medium is accepted data, and the grade rides
the pointer packet (`observedAotQuality`) for consumers that want the
strict high-only view. The `observedAot` overlay defaults on, a
document whose entries are not AOT-shaped contributes nothing, and
pointer packets carry `observedAot`.

Provenance is structural. Every strip declares whose data it draws
(`provenance: "model" | "crossModel" | "measurement"`), and the stack
splits spatially: the viewed model's own strips render as one group,
and anything foreign (another model's smoke, the Sun and AOT
measurement strips) renders below a labelled divider (*"beside this model — not in its
physics"*, `scene.stripDivider`) with its source and instant written
inside the strip itself (`sourceLabel`). The reference renderer
always draws the divider when any foreign strip exists. The one subtle
case is a model's own passive smoke: its data, so it stays above the
line, but the strip says *"this model's forecast · not in its
physics"*. A strip's position in the stack shows whose data it is; the
label states whether the model's own fluxes already felt the smoke.
Radiatively coupled smoke (HRRR) carries no statement
at all: it is ordinary model data.

## Render continuous field bands

Sampled stability, thermal-index, shear, humidity, vertical-velocity, and
dew-point-depression fields use interpolated iso-bands. Class boundaries cross
each grid cell at the underlying threshold instead of following rectangular
sample runs.

`sampledFieldPaths({ banding, nodesByHour, ...geometry })` accepts ascending
`breakpoints` and one `classNames` entry per interval. A `null` class remains
unpainted. Each returned band path contains its outer and inner threshold
outlines, so consumers fill `FieldLayer.paths` with `fill-rule="evenodd"`.
`renderMeteogramSvg` applies that rule.

The lower-level geometry helpers behind the scene (`windBarbParts`,
`curvedPath`, `interpolateVertical`, and friends) are exported for renderers
that compose their own layers; their contracts live in the shipped type
declarations.

The optional `buoyancyShear` strip draws zero-shear, nonzero-buoyancy hours as
`meteo-gram-bs-unopposed`. A blank cell remains reserved for a ratio that cannot be
computed.

Pass the model's declared capabilities (`options.capabilities`, the
`models.json` catalogue entry's own object) and the scene gates the
`verticalVelocity` field: when fewer than 3 declared omega levels sit
inside the altitude window (RDPS declares omega at 850 and 700 hPa
only, and a high site's floor prunes the lower one), the scene draws no
field and records why in `scene.suppressed`
(`{ key: "verticalVelocity", reason }`). `buildKeySpec` reads only what
was drawn, so a suppressed field never reaches the key. Two levels
cannot outline a band, only imply one, so the scene draws nothing.
Without a capabilities declaration no gate applies, because the
scene cannot know what the model publishes.

## Fit and label the consuming surface

| Option | Use it when | Behaviour |
| --- | --- | --- |
| `widthPx` | The chart must fill a known panel | Sets total scene width after hour windowing and wins over `columnWidthPx` |
| `columnWidthPx` | The chart should scroll by a chosen hour pitch | Sets pixels per hour when `widthPx` is absent |
| `minColumnWidthPx` / `maxColumnWidthPx` | A density policy bounds the pitch | Clamps the resolved pitch; a moved fit narrows the chart or lets it scroll. The minimum wins a conflict |
| `fitMinColumns` | Short windows must not stretch | The `widthPx` fit divides by at least this many columns; inert with explicit `columnWidthPx` |
| `hourLabel` | A surface needs 24-hour, 12-hour, or custom labels | Changes ticks and the scene aria label together |
| `stripLabels` | A publisher has its own display voice | Changes visible labels only; strip keys and CSS classes remain stable |
| `plotHeightPx` | The time-height panel needs a different vertical scale | Changes the panel height; strips retain fixed heights |
| `svgHeightPx` | The whole chart must fill a known panel height | Solves the panel height from the scene's own strip-stack and label geometry so `scene.height` equals the target exactly, and wins over `plotHeightPx`; the panel never solves below 1 px, so an impossible target overflows instead of inverting |

Use `widthPx` instead of probe-building to discover package gutters. The
package owns those gutters and derives `scene.scales.columnWidth`. A pitch
policy belongs in the same build: pass the bounds and the short-window
floor as options rather than building once to read the fitted pitch and
again to correct it.

## Control barb and marker density

`barbStride: "auto"` is geometry-aware and is the default. An explicit number
forces an hour stride. `barbMinGapPx` controls vertical clearance between
level barbs, while `barbScale` pins glyph scale; absent those overrides, both
follow the resolved column pitch. Gust labels use the same resolved hour
stride. `scene.scales.surfaceWindY` exposes the surface row's placement; use it
for hit-testing instead of assuming the plot floor.

`markerStride` can draw cloud and wing marker trains along `cloudBase` and
`usableLiftTop`. A number draws every n hours from the selected-hour anchor;
`{ every }` is the object form. Each train follows its own overlay, and where
usable lift reaches cloud base the coincident cloud and wing render as one
stacked symbol; trains never need phasing apart. With no stride, each line
keeps one marker at the selected hour.

## Mark the launch wind window

`launchWindows` takes the consumer's acceptable launch-wind arcs as
meteorological FROM bearings in degrees; an arc may wrap 360
(`{ fromDeg: 315, toDeg: 45 }` spans NW through NE), and any number of
arcs union. There is no default
([judgment parameters](/docs/core/conventions/) are the consumer's): omit
it and no marks draw. Given arcs, the scene tests each hour's surface p50 wind
direction against the union and emits `scene.windWindow` — one
`WindWindowMark { hourIndex, x, inWindow }` per hour, on a thin row the
reference renderer draws between the plot floor and the hour labels.
In-window hours draw as filled triangles and out-of-window hours as open
circles (`meteo-gram-wind-window-in` / `-out`, themed by the matching
`--meteo-gram-wind-window-*` tokens), so the states differ by shape as
well as colour, and the key gains a `windWindow` entry. Direction is
the only input: speed and gusts keep their own marks.

The scene reads the forecast engine's `derived.*` values by default. `sinkRateMps`
can recompute only the usable-lift series from published inputs for a
deterministic document. Palette is not scene data; apply `--meteo-gram-*` tokens when
rendering.

## Answer pointer positions

The hit-testing queries beside `buildMeteogramScene` share the plotted scales, keeping
tooltips and geometry aligned. Read them in the order a pointer event needs
them:

- `clientPointToScene(scene, rect, clientX, clientY)` maps a client-pixel
  position through the mount's bounding rect into scene coordinates, scaling
  x and y independently. It returns null for a zero-area rect, the
  measurement a hidden tab produces.
- `hourIndexForX(scene, x)` names the hour column under an x, null outside
  the plot; `hourIndexForX(scene, x, { clamp: true })` resolves to the
  nearest edge column instead, so strips and margins still select.
- `cursorReading(scene, x, y)` interpolates the continuous column
  (temperature, wind, lapse, stability class) at any altitude.
- `drawnBarbsForHour(scene, hourIndex)` and
  `nearestDrawnBarb(scene, hourIndex, y)` answer the discrete question
  instead: which barbs did this column actually draw (stride and min-gap
  thinning applied), and which is nearest the pointer. Each
  `BarbPlacement` carries its `hourIndex`, data `altitudeM`, and a
  `surface` flag: the surface barb draws at `scales.surfaceWindY`, above
  its data altitude, and the flag is its identity.
- `xForTime(scene, validAt)` positions an instant with sub-hour precision
  (time cursors, sunrise and sunset ticks), interpolating between hour
  centres; `{ clamp: true }` pins out-of-window instants to the frame edges.
- `hourIndexForValidAt(scene, validAt)` finds the rendered index for an
  instant, comparing timestamps rather than strings. Key stored selections
  by `validAt` and re-ask after every rebuild: hour windows renumber, and
  an index-keyed pin silently moves.

Each `scene.sampling` hour also carries two per-hour facts inspectors
keep re-deriving: `cloudCapped` (the published usable-lift top reaches
the published cloud base — null while the hour has no lift top, never
false-by-default) and `capeCapped` (the CAPE strip's CIN-cap dimming —
null when the model publishes no CAPE or no CIN, because absence is not
"no cap"). Both are the same computations the strip cells consume, so an
inspector's words match the drawn cells.

## Express a selection

`selection: { hourIndex, altitudeM? }` passes the consumer's selection (the
hour an inspector is reading, and optionally an altitude) into the build.
The scene resolves it against what it actually drew and reports the geometry
as `scene.selection`: the column, its centre line, and the nearest drawn barb
for the ring. `renderMeteogramSvg` draws all three (`meteo-gram-selection-*` classes, themed
by `--meteo-gram-selection`); one resolution feeds both the marks and any
readout the consumer renders. It is
distinct from `selectedHourIndex`, which the scene computes itself (the
peak-W* column).

The resolver is also exported: `resolveSelection(scene, { hourIndex,
altitudeM? })` returns the same `SceneSelection` geometry from an
already-built scene (it is the very function `buildMeteogramScene` calls), so a
consumer overlay that must not pay for a rebuild (a hover preview) draws
from the same geometry as the serializer-drawn pin.

The pointer wiring that feeds these queries (preview, pin, touch policy,
and carrying a pin across model switches) is a consumer state machine, not
scene data; [Wire an inspector](/docs/briefing/wire-an-inspector/) is the
worked recipe.
