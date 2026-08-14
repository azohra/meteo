---
title: Render a first Meteogram
description: Validate one profile and serialize a reference chart with its scene-derived key.
---

The `@azohra/meteo.briefing` package ships ESM types and requires no DOM. This example reads
a profile from disk, keeping loading policy separate from rendering. This is
what it produces:

![A ten-hour Meteogram for the synthetic Synthetic Ridge teaching scenario — morning stability giving way to a deep midday unstable column, with the boundary layer, usable lift, and cloud base tracing distinct arcs beneath light veering wind — and the key derived from its final scene.](figures/first-meteogram.svg)

1. Install the package:

   ```sh
   pnpm add @azohra/meteo.briefing
   ```

2. Validate the untrusted JSON, build a scene, and serialize the chart and its
   key:

   ```ts title="render-meteogram.ts"
   import { readFileSync, writeFileSync } from "node:fs";
   import { parseSiteForecast } from "@azohra/meteo.briefing/contract";
   import {
     buildKeySpec,
     buildMeteogramScene,
     renderKeySvg,
     renderMeteogramSvg,
   } from "@azohra/meteo.briefing/meteogram";

   const raw: unknown = JSON.parse(readFileSync("./profile.json", "utf8"));
   const profile = parseSiteForecast(raw);
   if (!profile) throw new Error("unsupported or invalid profile");

   const timeZone = profile.site.timeZone;
   if (!timeZone) throw new Error("older profile needs an explicit IANA timezone");
   const scene = buildMeteogramScene(profile, {
     timeZone,
     // The launch marker is a render input — documents are launch-agnostic.
     // Use site-context.json's measured elevation pick; omit for no marker.
     launch: { elevationM: 1591 },
     widthPx: 960,
     hourLabel: "12h",
   });
   const svg = renderMeteogramSvg(scene, { idPrefix: "club-main" });
   const keySvg = renderKeySvg(buildKeySpec(scene), { idPrefix: "club-main-key" });
   writeFileSync("./meteogram.svg", svg);
   writeFileSync("./meteogram-key.svg", keySvg);
   ```

3. Place both SVGs in the consuming page or build. Each serializer returns a
   complete `<svg>` document with the same token authority. Rebuild the
   scene-derived key whenever controls rebuild the scene.

> **Note — timezone is explicit presentation input.** Profiles store UTC
> instants. `buildMeteogramScene` requires the chosen zone, so pass the
> document's optional
> [`site.timeZone` echo](/docs/briefing/profile-document/#run-site-and-semantics)
> or a caller-owned fallback. Never infer it from a name or coordinate.

## Load static publications safely

This example reads from disk. When the profile instead arrives from
independently cached static storage, use `loadForecast()` from
`@azohra/meteo.briefing/transport`; the [transport guide](/docs/briefing/transport/)
defines its consistent-pair result, `stale` flag, and discriminated miss.
