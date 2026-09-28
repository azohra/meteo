---
title: "Briefing: the read side"
description: "The @azohra/meteo.briefing package: validate published forecast documents, derive and analyze their values, compare models and runs, and draw them as Meteograms, soundings, and compare boards."
---

`@azohra/meteo.briefing` is the TypeScript package for reading the forecasts
the engine publishes. It validates each [document](/docs/glossary/#document),
turns it into typed values and [findings](/docs/glossary/#finding), and can
draw it as a chart. It runs in Node, a worker, or a browser; only `/history`
needs Node.

The package installs on its own and needs Node 22 or later. Browsers and
workers need no Node at all.

```sh
pnpm add @azohra/meteo.briefing
```

Each capability has its own subpath:

```ts
import { parseSiteForecastJson } from "@azohra/meteo.briefing/contract";
import { analyzeForecast } from "@azohra/meteo.briefing/analyze";
import { buildMeteogramScene, renderMeteogramSvg } from "@azohra/meteo.briefing/meteogram";
```

`/history` is the one Node-only subpath, because it reads gzip archives with
`node:zlib`. The documents themselves come from the forecast engine,
[`@azohra/meteo.forecast`](/docs/forecast/).

## How the package is organized

The package has two tiers. The **data tier** validates, derives, analyzes,
compares, loads, and archives. It needs no DOM and returns typed values. The
**presentation tier** draws three kinds of chart: the
[Meteogram](/docs/briefing/reading-a-meteogram/) (`/meteogram`), the
single-hour [sounding](/docs/briefing/sounding/) (`/sounding`), and the
[compare board](/docs/briefing/compare-board/) (`/compare-board`). Each chart
is built in two steps. A validated document becomes a serializable
[scene](/docs/glossary/#scene), and the scene becomes deterministic SVG.

If you are new, start with
[Render a first Meteogram](/docs/briefing/render-first-meteogram/). It uses
both tiers in one short script.

## The data tier

| Page | Covers |
|---|---|
| [Contract validation](/docs/briefing/contract/) | Accepting profile, manifest, model, site, and run-index documents at an explicit trust boundary |
| [Load published documents](/docs/briefing/transport/) | Fetching consistent publications: run-stamp guards, retries, and misses told apart from failures |
| [Pure derivations](/docs/briefing/derive/) | Quantities computed from published values, local-day projection, and valid-time alignment |
| [Analyze a profile](/docs/briefing/analyze/) | `analyzeForecast`: typed findings over one forecast, with thresholds and evidence attached |
| [Compare model profiles](/docs/briefing/compare/) | `compareForecasts` and `compareAnalyses`: cross-model agreement, spread, and divergence for one site |
| [History and run convergence](/docs/briefing/history/) | The month-archive reader and `compareRuns` convergence |

## The documents

| Page | Covers |
|---|---|
| [Profile document](/docs/briefing/profile-document/) | The per-site forecast document: blocks, run and site provenance, semantics |
| [Smoke document](/docs/briefing/smoke-document/) | The per-site wildfire-smoke series: fields, units, verified provider facts, and how it joins the profile |
| [Observation document](/docs/briefing/observation-document/) | The measured GOES-18 series: DSR and AOD, validity rules, product facts |
| [Site context document](/docs/briefing/site-context-document/) | Measured ground truth per site: the elevation pick, terrain, land cover, licences |
| [Model manifest](/docs/briefing/manifest/) | One model publication's identity, extent, sites, and build accounting |
| [Model catalogue](/docs/briefing/catalogue/) | `models.json`: model discovery and declared capabilities |
| [Ensemble values](/docs/briefing/ensemble-values/) | Percentile blocks, contributor counts, censoring, circular wind |
| [History archives](/docs/briefing/history-archives/) | The append-only monthly gzip archives and their sidecar indexes |
| [Package versioning](/docs/briefing/versioning/) | npm versions and the finding vocabularies. Document versions are covered in [Compatibility](/docs/compatibility/) |

## The presentation tier

| Page | Covers |
|---|---|
| [Render a first Meteogram](/docs/briefing/render-first-meteogram/) | Fetch a profile, validate it, and write a chart and its key to SVG |
| [Build a scene graph](/docs/briefing/scene/) | Serializable geometry and hit-testing from one validated profile |
| [Render SVG and a scene-derived key](/docs/briefing/svg/) | Deterministic SVG from a scene, styled through package defaults and tokens |
| [Reading a Meteogram](/docs/briefing/reading-a-meteogram/) | What every mark on the chart means, and how to read it |
| [The sounding](/docs/briefing/sounding/) | One hour as a vertical profile of the flyable band: traces, parcel, wind ladder, with dots at published levels and straight segments between |
| [Compare board](/docs/briefing/compare-board/) | One local day for every member of a comparison, on one shared clock, with a minimal SVG serializer |

## Recipes

The package does not ship stateful pieces like an interactive inspector or a
local store. These two pages show how to build them from its pure queries and
transports.

| Page | Covers |
|---|---|
| [Wire an inspector](/docs/briefing/wire-an-inspector/) | Pointer, keyboard, and pinned selections over the scene's pure queries |
| [Run an ingest](/docs/briefing/run-an-ingest/) | Store and serve: poll `runs.json`, ingest consistent publications, and keep serving through gaps |

JSON Schema for the published documents, with annotated examples, is in
[`schema/`](https://github.com/azohra/meteo/tree/main/briefing/schema). Every
package that publishes wire documents follows the same
[schema-artifact convention](/docs/core/failures-and-schema/#schema-artifacts).
