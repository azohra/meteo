---
title: "The sounding"
description: "Draw one forecast hour as a vertical profile of the flyable band: temperature, dew point, a lifted parcel, and wind, drawn only from the model's published levels."
---

The sounding is the package's second chart family. It draws one forecast
hour of a validated profile document as a vertical profile. The Meteogram
connects a day of columns through time, and the sounding opens up a single
column. It shows temperature and dew point against height, a lifted parcel
beside them, and a wind-barb ladder in the right margin. The derived
heights (boundary layer top, cloud base, usable lift top) appear as
horizontal marks. The sounding has its own subpath and works in the same
two steps as the Meteogram: a renderer-independent scene graph, then
deterministic SVG. This page is the reference for that subpath. If you
have not rendered a profile before, start at
[Render a first Meteogram](/docs/briefing/render-first-meteogram/).

## What this chart is

This is a profile of the flyable band, and it stops where the published
column stops. Both axes are linear: height in metres MSL, with the floor
at the model elevation, and temperature. It is not a skew-T. It has no
skewed temperature coordinate and no adiabat grid, because the input
cannot fill one. A profile document carries only the levels its model
publishes in the flyable band. The deterministic models in the catalogue
publish nothing above 600 hPa, and ensemble models publish far fewer
levels than that, so the upper half of a skew-T would be invented. The
chart draws exactly the published column and prints where it ends. It
draws and implies nothing above the top level.

The marks follow the same rule. A derived height that the document does
not carry adds no mark, and an hour whose required medians are absent
builds no scene at all.

## Build the scene for one hour

`buildSoundingScene(profile, options)` selects the hour by instant, and
`options.validAt` is the only selector. An instant the profile does not
publish returns `null` rather than throwing. The scene echoes `validAt`
back, so a Meteogram selection can drive a sounding next to it, and
nothing public is keyed by hour index.

```ts title="build-sounding.ts"
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { buildSoundingScene, renderSoundingSvg } from "@azohra/meteo.briefing/sounding";

export function soundingAt(profile: SiteForecast, validAt: string): string | null {
  const scene = buildSoundingScene(profile, {
    validAt,
    // Supply the launch elevation if you want the mark; the document
    // has none.
    launch: { elevationM: 1225.1 },
  });
  if (scene === null) return null; // the profile does not publish this instant
  return renderSoundingSvg(scene, { idPrefix: "club-sounding" });
}
```

To pair the sounding with a Meteogram, take the instant from the
Meteogram's own scene instead of formatting one yourself:

```ts title="drive-from-meteogram.ts"
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { buildMeteogramScene } from "@azohra/meteo.briefing/meteogram";
import { buildSoundingScene } from "@azohra/meteo.briefing/sounding";

export function soundingForSelectedHour(profile: SiteForecast, timeZone: string) {
  const meteogram = buildMeteogramScene(profile, { timeZone });
  const validAt = meteogram.hourValidAts[meteogram.selectedHourIndex];
  return buildSoundingScene(profile, {
    validAt,
    // Pin the altitude axis to the Meteogram's own domain so the two
    // charts read against the same scale.
    floorM: meteogram.scales.floorM,
    topM: meteogram.scales.topM,
  });
}
```

By default the altitude domain follows the Meteogram's rules over the
whole profile plus the launch. The floor sits at the model elevation, and
the top is padded above every level and every drawn derived height. The
axis therefore stays still while a consumer scrubs through hours.
`floorM` and `topM` override the domain, and `widthPx` and `heightPx` set
the SVG size. `overlays` turns each drawn layer on or off: `temperature`,
`dewPoint`, `parcel`, `wind`, `boundaryLayerTop`, `cloudBase`,
`usableLiftTop`, and `launch`. All of them are on by default, and
`DEFAULT_SOUNDING_OVERLAYS` exports the set.

## Count the levels off the chart

The chart shows no more vertical resolution than the document carries.

- Every published level draws as a dot on the temperature and dew-point
  traces, with one more dot for the surface sample. A reader can count
  the model's levels directly off the chart. The note under the plot
  states the count and where the column ends
  (`5 published levels · top of column 2538 m`).
- Segments between dots are straight, so the chart suggests no structure
  between levels that the model did not publish. The measured environment
  draws solid. Only the parcel trace is dashed, because it is the one
  derived trace rather than a published value.
- A 5-level ensemble column renders as five dots and four straight
  segments, with p25–p75 envelopes behind the traces and behind each
  ensemble-valued mark. The envelope is the members' spread at the
  published levels, joined by the same straight segments as the median.
- The wind ladder is not thinned. It has one barb at the surface and one
  per published level, at that level's drawn height. Feathers are 5, 10,
  and 50 km/h, as on the Meteogram.

## The parcel trace and the LCL

The parcel trace lifts the hour's surface parcel through the published
levels. It rises dry-adiabatically to its lifting condensation level (LCL)
and moist pseudo-adiabatically above it. The chart draws the parcel's
temperature next to the environment's and marks the LCL on the trace when
it falls inside the drawn band. Buoyancy at any height is the horizontal
gap between the parcel trace and the temperature trace.
`readingAtAltitude` reports it as a number, as a virtual-temperature
difference so that moisture counts. For ensemble documents the parcel
starts from the p50 member, and the parcel trace itself has no envelope.

## Answer pointer positions

`readingAtAltitude(scene, y)` interpolates the column at a scene y. It
returns temperature, dew point, dew-point depression, wind speed and
direction, parcel temperature, and buoyancy. Each value is `null` above
the published column or where the document carries no value.
Interpolation is linear between published levels, which matches the
straight segments on the chart, so a tooltip and the pixels agree.
`yForAltitude`, `altitudeForY`, and `xForTemperature` expose the scales
for consumer overlays.

## Render SVG and the scene-derived key

`renderSoundingSvg(scene, { idPrefix })` emits a self-contained SVG
document with stable ordering and two-decimal geometry. Identical input
produces identical bytes. Give each sounding on a page its own
`idPrefix`.

The chart labels itself in place. Each trace prints its name in ink
behind a short chip of line in the trace's colour, at the surface end.
Each altitude mark, and the LCL, prints its name and height next to its
own line, on the half of the plot farther from the traces at that
altitude. Both sets of labels are placed deterministically so they do not
collide. Marks at the same height stack a minimum gap apart, and a label
moved off its true height carries a leader tick back to it. Because of
this, `buildSoundingKeySpec(scene)` keys only what the plot does not
already label: the published-level dot, the ensemble envelope when one is
drawn, and the calm circle when the wind ladder drew a calm level. That
is three entries at most. Pass `selfLabeled` to add the self-labeling
traces, marks, and LCL back into the key; the exported
`SOUNDING_SELF_LABELED` is the complete set. `renderSoundingKeySvg`
serializes the spec with the same stylesheet. Rebuild the key from the
final scene after every overlay change.

## Theming

The chart is styled by its own `--meteo-sounding-*` token family.
`SOUNDING_TOKEN_DEFAULTS` holds the default values.
`SOUNDING_TRACE_TOKENS` and `SOUNDING_MARK_TOKENS` map each drawn class to
the token that colours it, for legends and focus styles. Quantities that
appear on both charts keep the Meteogram's colours (cloud base is the same
colour on both), but the sounding reads only its own token family.
Override tokens on an ancestor, as the
[SVG renderer page](/docs/briefing/svg/) describes for the Meteogram, or
pass `stylesheet: null` to supply all the class styling yourself. Colour
is always paired with another encoding. The environment traces are solid
and the derived parcel trace is dashed, every trace prints its name in
ink next to a chip of line, marks differ by dash and printed label, and
the dots and the note work with any palette.
