---
title: Units, angles, one wind sign
description: The unit vocabulary, angle helpers, and the single wind sign convention the platform's wire documents share.
---

The station and briefing packages compute with the same physical vocabulary
(units, angles, and one wind sign convention), defined by
[`units.ts`](https://github.com/azohra/meteo/blob/main/core/src/units.ts),
[`angles.ts`](https://github.com/azohra/meteo/blob/main/core/src/angles.ts),
and [`wind.ts`](https://github.com/azohra/meteo/blob/main/core/src/wind.ts).

## One wind sign convention

Wind values carry two complementary representations, and the sign convention
between them is fixed platform-wide:

Direction is meteorological: the compass bearing the wind blows *from*,
in degrees clockwise from north. Components are the velocity of the air
itself: `uMps` is the zonal component, positive eastward; `vMps` is the
meridional component, positive northward; both in m/s.

The two representations point opposite ways, and the conversion owns that
minus sign so no other package ever writes it:

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
from-directions (every direction weighted equally, regardless of speed)
and returns `null` on empty input. Averaging compass degrees arithmetically
is wrong across north (350° and 10° average to 180°); the circular mean
reports 0°.

## Units

Speeds compute in m/s; km/h is a display conversion:

- `KMH_PER_MPS`: the constant `3.6`.
- `kmhToMps(value)`: divides by `KMH_PER_MPS`.
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

An arc of acceptable from-directions (a station's favorable sectors, a
launch's wind window) is one shape platform-wide, defined by
[`arcs.ts`](https://github.com/azohra/meteo/blob/main/core/src/arcs.ts):

- `DirectionArc`: `{ fromDeg, toDeg }`, meteorological FROM bearings in
  degrees clockwise from north. `fromDeg > toDeg` wraps through north, and
  both boundaries are inclusive. `fromDeg === toDeg` reads as a single
  bearing, not a full circle.
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

Arcs are a judgment parameter wherever they gate a drawing or a verdict:
no package supplies a default list, and a consumer that passes none gets
no marks drawn.
