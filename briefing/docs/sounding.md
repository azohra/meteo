---
title: "The sounding"
description: "One forecast hour drawn as a vertical profile of the flyable band: temperature, dew point, a lifted parcel, and wind, honest about the model's published levels."
---

The sounding is the package's second chart family: one forecast hour of a
validated profile document, drawn as a vertical profile. Where the
Meteogram connects a day of columns through time, the sounding opens a
single column up — temperature and dew point against height, a lifted
parcel beside them, a wind-barb ladder in the right margin, and the
derived heights (boundary layer top, cloud base, usable lift top) as
horizontal marks. It lives behind its own subpath and follows the same
two-step shape as the Meteogram: a renderer-independent scene graph, then
deterministic SVG. This page is the reference for that subpath; rendering
a profile at all starts at
[Render a first Meteogram](/docs/briefing/render-first-meteogram/).

## What this chart is — and is not

This is a **flyable-band profile, capped by the published column**. The
axes are linear height (metres MSL, floor at the model elevation) and
linear temperature — deliberately not a skew-T: there is no skewed
temperature coordinate and no adiabat grid, because the input cannot
honour one. A profile document carries only the levels its model
publishes into the flyable band — the deterministic models in the
catalogue publish nothing above 600 hPa, and ensemble models publish far
fewer levels than that — so a skew-T's upper half would be invented. The
chart draws exactly the published column and prints where it ends;
nothing above the top level is drawn or implied.

The same discipline governs the marks: a derived height that the
document does not carry adds no mark, and an hour whose required medians
are absent builds no scene at all.

## Build the scene for one hour

`buildSoundingScene(profile, options)` selects the hour by instant.
`options.validAt` is the whole selection contract: an instant the
profile does not publish returns `null` — never an exception — and the
scene echoes `validAt` back, so a Meteogram selection can drive a
sounding beside it and nothing public is keyed by hour index.

```ts title="build-sounding.ts"
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { buildSoundingScene, renderSoundingSvg } from "@azohra/meteo.briefing/sounding";

export function soundingAt(profile: SiteForecast, validAt: string): string | null {
  const scene = buildSoundingScene(profile, {
    validAt,
    // The launch is yours, not the document's; omit it and no launch mark draws.
    launch: { elevationM: 1225.1 },
  });
  if (scene === null) return null; // the profile does not publish this instant
  return renderSoundingSvg(scene, { idPrefix: "club-sounding" });
}
```

To pair the sounding with a Meteogram, take the instant from the
Meteogram's own scene rather than formatting one:

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
whole profile plus the launch — floor at the model elevation, top padded
above every level and drawn derived height — so the axis stays put while
a consumer scrubs hours. `floorM` and `topM` override it; `widthPx` and
`heightPx` size the SVG; `overlays` toggles each drawn layer
(`temperature`, `dewPoint`, `parcel`, `wind`, `boundaryLayerTop`,
`cloudBase`, `usableLiftTop`, `launch` — all on by default,
`DEFAULT_SOUNDING_OVERLAYS` exports the set).

## Sparse honesty: count the levels off the chart

The chart never pretends to more vertical resolution than the document
carries:

- **Every published level draws as a dot** on the temperature and
  dew-point traces (plus one dot for the surface sample). The reader can
  count the model's levels directly off the chart, and the plain note
  under the plot states the count and where the column ends
  (`5 published levels · top of column 2538 m`).
- **Segments between dots are straight** — never a curve, so nothing
  suggests structure between levels that the model never published. The
  measured environment draws solid; only the parcel trace dashes,
  because it alone is a derivation rather than a published value.
- **A 5-level ensemble column renders honestly**: five dots, four
  straight segments, and p25–p75 envelopes behind the traces and behind
  each ensemble-valued mark. The envelope is the members' spread at the
  published levels, interpolated by the same straight segments as the
  median.
- **The wind ladder is unthinned**: one barb at the surface and one per
  published level, at the level's drawn height. Feathers are 5, 10, and
  50 km/h, as on the Meteogram.

## The parcel trace and the LCL

The parcel trace lifts the hour's surface parcel through the published
levels — dry-adiabatically to its lifting condensation level, moist
pseudo-adiabatically above — and draws the parcel's temperature beside
the environment's, with the LCL marked on the trace where it falls
inside the drawn band. Buoyancy at any height is the horizontal gap
between the parcel trace and the temperature trace, and
`readingAtAltitude` reports it numerically (as a virtual-temperature
difference, so moisture counts). Ensemble documents resolve to the p50
member before the ascent; the parcel trace itself carries no envelope.

## Answer pointer positions

`readingAtAltitude(scene, y)` interpolates the column at a scene y:
temperature, dew point, dew-point depression, wind speed and direction,
parcel temperature, and buoyancy, each `null` above the published column
or where the document carries no value. Interpolation is linear between
published levels — exactly the straight segments the chart draws, so a
tooltip and the pixels cannot disagree. `yForAltitude`, `altitudeForY`,
and `xForTemperature` expose the scales for consumer overlays.

## Render SVG and the scene-derived key

`renderSoundingSvg(scene, { idPrefix })` emits a self-contained SVG
document: stable ordering, two-decimal geometry, identical bytes for
identical input. Give each sounding on a page its own `idPrefix`.

The chart labels itself in place: each trace carries its name in ink
behind a short line-chip in the trace's colour at the surface end, and
each altitude mark (and the LCL) prints its name and height beside its
own line, anchored on the half of the plot farthest from the traces at
that altitude. Both label sets are collision-solved deterministically —
coincident marks stack a minimum gap apart, and a label nudged off its
true height carries a leader tick back to it — so `buildSoundingKeySpec(scene)`
keys only what the plot cannot say for itself: the published-level dot,
the ensemble envelope when one drew, and the calm circle when the wind
ladder drew a calm level. That is at most three entries. Pass
`selfLabeled` (the exported `SOUNDING_SELF_LABELED` is the complete set)
to opt the self-labeling traces, marks, and LCL back into the key, and
`renderSoundingKeySvg` serializes the spec with the same stylesheet.
Rebuild the key from the final scene after every overlay change.

## Theming

The chart is themed by the `--meteo-sounding-*` token family, the
sounding's own: `SOUNDING_TOKEN_DEFAULTS` is the one home for the
default values, and `SOUNDING_TRACE_TOKENS` / `SOUNDING_MARK_TOKENS` map
each drawn class to the token that colours it, for legends and focus
styles. Shared meanings keep the Meteogram's values — cloud base is the
same colour on both charts — but the sounding reads only its own family;
override tokens on an ancestor, exactly as the
[SVG renderer page](/docs/briefing/svg/) describes for the Meteogram,
and pass `stylesheet: null` to supply all class styling yourself. Colour
is never the only encoding: the solid environment traces differ from the
dashed parcel derivation, every trace prints its name in ink beside a
line-chip, marks differ by dash and printed label, and the dots and note
survive any palette.
