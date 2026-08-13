---
title: "Forecast: the read side"
description: The forecast capability — the published site-forecast contract and its pure functions, plus the Meteogram presentation tier that renders validated documents as point-forecast time-height charts.
---

The **briefing** capability is the published site-forecast contract and
everything that is a pure function of it — validation, derivation, analysis,
comparison across models and across a model's own successive runs,
transport, and the append-only history. If a result is meaningful without a
chart, it lives here.

The package has two tiers. The **data tier** — contract, derivations,
analysis, comparison, transport, history — needs no DOM and produces typed
values and findings. The **presentation tier** — `/meteogram` — is
the Meteogram: a validated document becomes a serializable scene graph,
and the scene becomes deterministic SVG. Every surface is an explicit
subpath of `@azohra/meteo.briefing`:

```ts
import { parseSiteForecastJson } from "@azohra/meteo.briefing/contract";
import { analyzeForecast } from "@azohra/meteo.briefing/analyze";
import { buildMeteogramScene, renderMeteogramSvg } from "@azohra/meteo.briefing/meteogram";
```

The producing side — the engine that samples providers and publishes the
documents this capability consumes — is
[`@azohra/meteo.forecast`](/docs/forecast/). `/history` is the one Node-only
subpath (`node:zlib`).

## The documentation

Each page is the single authority for its topic. Start with
[Render a first Meteogram](/docs/briefing/render-first-meteogram/) to see
both tiers in one working example.

### The data tier

| Page | Covers |
|---|---|
| [Contract validation](/docs/briefing/contract/) | Accepting profile, manifest, model, site, and run-index documents at an explicit trust boundary |
| [Load published documents](/docs/briefing/transport/) | Fetching consistent publications — run-stamp guards, retries, misses discriminated from failures |
| [Pure derivations](/docs/briefing/derive/) | Pure quantities from published state, local-day projection, valid-time alignment |
| [Analyze a profile](/docs/briefing/analyze/) | `analyzeForecast`: typed findings over one forecast, with thresholds and evidence attached |
| [Compare model profiles](/docs/briefing/compare/) | `compareForecasts` / `compareAnalyses`: cross-model agreement, spread, and divergence for one site |
| [History and run convergence](/docs/briefing/history/) | The append-only month-archive reader and `compareRuns` convergence |

### The presentation tier

| Page | Covers |
|---|---|
| [Render a first Meteogram](/docs/briefing/render-first-meteogram/) | Validate one profile and serialize a reference chart with its scene-derived key |
| [Build a scene graph](/docs/briefing/scene/) | Serializable geometry and hit-testing from one validated profile |
| [Render SVG and a scene-derived key](/docs/briefing/svg/) | Deterministic SVG from a scene, styled by package tokens |
| [Defaults and tokens](/docs/briefing/defaults-and-tokens/) | Configuring the reference scene and renderer through options and tokens |
| [Reading a Meteogram](/docs/briefing/reading-a-meteogram/) | What every mark on the rendered chart means, and how to read it |

### Recipes

Two pages document state the package deliberately does not ship, as
recipes over its pure queries and transports:

| Page | Covers |
|---|---|
| [Wire an inspector](/docs/briefing/wire-an-inspector/) | Pointer, keyboard, and pinned selections over the scene's pure queries |
| [Run an ingest](/docs/briefing/run-an-ingest/) | The store-and-serve loop: poll `runs.json`, ingest coherent publications, serve through gaps |

JSON Schema for the published documents lives in
[`schema/`](https://github.com/azohra/meteo/tree/main/briefing/schema),
with committed annotated examples — the same convention the station wire
schemas follow in their own package.
