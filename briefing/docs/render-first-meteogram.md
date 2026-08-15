---
title: Render a first Meteogram
description: "Fetch a published forecast, validate it, and serialize a reference chart with its scene-derived key — one script, run with node."
---

The `@azohra/meteo.briefing` package ships ESM types and requires no DOM:
the same script runs in Node, workers, and browsers. This page fetches a
real published document from the live sample dataset and renders it. The
kind of chart it produces (this one from the Synthetic Ridge teaching
scenario):

![A ten-hour Meteogram for the synthetic Synthetic Ridge teaching scenario (morning stability giving way to a deep midday unstable column, with the boundary layer, usable lift, and cloud base tracing distinct arcs beneath light veering wind) and the key derived from its final scene.](figures/first-meteogram.svg)

1. Install the package (Node 22 or later):

   ```sh
   pnpm add @azohra/meteo.briefing
   ```

2. Fetch a published profile and its site context, validate both at the
   text boundary, build a scene, and serialize the chart and its key:

   ```js title="render-meteogram.mjs"
   import { writeFileSync } from "node:fs";
   import { parseSiteContextJson, parseSiteForecastJson } from "@azohra/meteo.briefing/contract";
   import {
     buildKeySpec,
     buildMeteogramScene,
     renderKeySvg,
     renderMeteogramSvg,
   } from "@azohra/meteo.briefing/meteogram";

   // The live sample dataset: one real HRDPS run over three synthetic sites.
   const base = "https://meteo.azohra.com/data-sample";

   const profile = parseSiteForecastJson(
     await (await fetch(`${base}/hrdps-continental/sites/test-hill.json`)).text(),
   );
   if (!profile) throw new Error("profile failed contract validation");

   // The launch marker is a render input — documents are launch-agnostic
   // (a "launch" is the place you fly; the document's "site" is its record).
   // site-context.json at the dataset root carries the measured elevation pick.
   const context = parseSiteContextJson(
     await (await fetch(`${base}/site-context.json`)).text(),
   );
   const launchElevationM = context?.sites[profile.site.id]?.elevation.elevationM;

   const timeZone = profile.site.timeZone;
   if (!timeZone) throw new Error("older profile needs an explicit IANA timezone");

   const scene = buildMeteogramScene(profile, {
     timeZone,
     launch: launchElevationM === undefined ? undefined : { elevationM: launchElevationM },
     widthPx: 960,
     hourLabel: "12h",
   });
   writeFileSync("./meteogram.svg", renderMeteogramSvg(scene, { idPrefix: "club-main" }));
   writeFileSync("./meteogram-key.svg", renderKeySvg(buildKeySpec(scene), { idPrefix: "club-main-key" }));
   console.log(`rendered ${profile.site.name} at ${launchElevationM} m: meteogram.svg + meteogram-key.svg`);
   ```

3. Run it:

   ```sh
   node render-meteogram.mjs
   ```

   ```text
   rendered Test Hill at 1225.1 m: meteogram.svg + meteogram-key.svg
   ```

4. Put the chart in your page. Each serializer returns a complete,
   self-contained `<svg>` document: inline the string into any HTML page,
   template, or build output — no runtime, stylesheet, or script required
   beside it. Rebuild the scene-derived key whenever controls rebuild the
   scene. To make the mounted chart interactive, continue with
   [Wire an inspector](/docs/briefing/wire-an-inspector/).

> **Note: timezone is explicit presentation input.** Profiles store UTC
> instants. `buildMeteogramScene` requires the chosen zone, so pass the
> document's optional
> [`site.timeZone` echo](/docs/briefing/profile-document/#run-site-and-semantics)
> or a caller-owned fallback. Never infer it from a name or coordinate.

## Load static publications safely

Bare `fetch` is fine for a first render. When your application loads a
model's manifest and profiles from independently cached static storage, use
`loadForecast()` from `@azohra/meteo.briefing/transport` instead; the
[transport guide](/docs/briefing/transport/) defines its consistent-pair
result, `stale` flag, and discriminated miss.
