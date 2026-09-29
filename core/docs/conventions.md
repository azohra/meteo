---
title: Units, angles, one wind sign
description: The unit vocabulary, angle helpers, direction arcs, and the single wind sign convention the platform's wire documents share.
---

The station and briefing packages compute with the same units, angles, and
wind sign convention. They are defined in
[`units.ts`](https://github.com/azohra/meteo/blob/main/core/src/units.ts),
[`angles.ts`](https://github.com/azohra/meteo/blob/main/core/src/angles.ts),
and [`wind.ts`](https://github.com/azohra/meteo/blob/main/core/src/wind.ts).

## One wind sign convention

Wind values carry two complementary representations, and the sign
convention between them is fixed across the platform.

Direction is meteorological. It is the compass bearing the wind blows
*from*, in degrees clockwise from north. Components are the velocity of
the air itself. `uMps` is the zonal component, positive eastward, and
`vMps` is the meridional component, positive northward. Both are in m/s.

The two representations point opposite ways. The conversion owns that
minus sign, so no other package ever writes it.

- `windToComponents(speedMps, directionDeg)` computes
  `uMps = -speed · sin(θ)` and `vMps = -speed · cos(θ)`, where θ is the
  from-direction in radians.
- `componentsToWind(uMps, vMps)` recovers speed and from-direction. Calm air
  (both components exactly zero) reports direction `0`.

So a 10 m/s wind *from* the west (direction 270°) has `uMps = 10`: the air
moves eastward.

```ts
import { componentsToWind, windToComponents } from "@azohra/meteo.core";

// A 10 m/s wind from the west (direction 270°) moves air eastward:
const { uMps, vMps } = windToComponents(10, 270);
// uMps === 10; vMps ≈ 0 (floating point, ~2e-15)

// And back: purely eastward-moving air is a wind from the west.
const wind = componentsToWind(10, 0);
// wind.speedMps === 10; wind.directionDeg === 270
```

The `WindComponents` interface names the component pair (`uMps`, `vMps`)
wherever it travels between packages.

### Mean direction

`meanDirectionDeg(directionsDeg)` is the unit-vector circular mean of
from-directions (every direction weighted equally, regardless of speed).
It returns `null` on empty input. Averaging compass degrees arithmetically
is wrong across north, where 350° and 10° average to 180°. The circular
mean reports 0°.

## Units

Speeds are computed in m/s, and km/h is a display conversion.

- `KMH_PER_MPS`: the constant `3.6`.
- `kmhToMps(value)`: divides by `KMH_PER_MPS`.
- `msToKmh(value)`: multiplies by `KMH_PER_MPS`.
- `plausibleWindMps(value, subject)`: returns the wind speed unchanged, or
  throws when it is outside the plausible 0–140 m/s range. The `subject`
  names the source in the error message, so a decoder or adapter that
  produces an impossible speed fails loudly with its name attached.

## Angles

- `DEGREES_TO_RADIANS`: the constant `Math.PI / 180`.
- `degreesToRadians(degrees)` / `radiansToDegrees(radians)`: the two
  conversions.
- `normalizeDegrees(degrees)`: wraps any degree value, including negative
  values, into `[0, 360)`.

## Direction arcs

An arc of acceptable from-directions, such as a station's favorable
sectors or a launch's wind window, has one shape across the platform. It
is defined in
[`arcs.ts`](https://github.com/azohra/meteo/blob/main/core/src/arcs.ts).

- `DirectionArc`: `{ fromDeg, toDeg }`, meteorological FROM bearings in
  degrees clockwise from north. `fromDeg > toDeg` wraps through north, and
  both boundaries are inclusive. `fromDeg === toDeg` reads as a single
  bearing rather than a full circle.
- `inDirectionArcs(directionDeg, arcs)`: whether a bearing falls inside any
  arc of the list; an empty list holds nothing.
- `directionArcSpanDeg(arc)`: the arc's clockwise span in `[0, 360)`.

```ts
import { inDirectionArcs } from "@azohra/meteo.core";

// A NW-through-NE window wraps through north:
const window = [{ fromDeg: 315, toDeg: 45 }];
inDirectionArcs(0, window); // true — due north sits inside the wrap
inDirectionArcs(180, window); // false
```

Wherever arcs gate a drawing or a verdict, they are a judgment parameter.
No package supplies a default list, and a consumer that passes none gets
no marks drawn.
