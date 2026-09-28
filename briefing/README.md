# `@azohra/meteo.briefing`

Read the forecasts the meteo engine publishes. This package validates
each published document, derives and analyzes its values, compares models
and successive runs, and draws the result as a Meteogram, a sounding, or a
compare board. It runs in Node, workers, and browsers; only `/history`
needs Node.

```sh
pnpm add @azohra/meteo.briefing
```

## Entry points

| Entry point | What it is |
|---|---|
| `@azohra/meteo.briefing` | The package root. It re-exports the contract: document types, zod schemas, and parse guards that never throw, for every published document kind. |
| `@azohra/meteo.briefing/contract` | The contract itself: `SiteForecast`, the smoke and observation documents, manifests, catalogues, the runs index, and their parsers. |
| `@azohra/meteo.briefing/derive` | Pure meteorological derivations of published values: lapse rates, the virtual-temperature parcel ascent and its thermal index, shear, usable-lift top at a chosen sink rate, moisture, smoke transmittance, projection, alignment, and local-day helpers. |
| `@azohra/meteo.briefing/analyze` | `analyzeForecast`: typed findings over one forecast (thermal window, cap timing, wind exceedance, smoke impact, and the rest of a closed vocabulary), plus the public `AnalysisFrame` for your own extensions. |
| `@azohra/meteo.briefing/compare` | `compareForecasts` and `compareAnalyses`: cross-model agreement, spread, and divergence findings for one site. |
| `@azohra/meteo.briefing/transport` | Consistent loading of published documents: run-stamp guards, retries, and misses told apart from failures. |
| `@azohra/meteo.briefing/history` | The append-only archive reader and `compareRuns` convergence. This is the one Node-only subpath (`node:zlib`). |
| `@azohra/meteo.briefing/meteogram` | The Meteogram: a renderer-independent scene graph (layout, hit-testing, key spec) and a deterministic SVG serializer with its token defaults. |
| `@azohra/meteo.briefing/sounding` | The sounding: one forecast hour as a vertical profile of temperature, dew point, a lifted parcel, and wind, as a renderer-independent scene graph and an SVG serializer. |
| `@azohra/meteo.briefing/compare-board` | The compare board: one local day for every member of a comparison, on one shared clock, as a renderer-agnostic scene plus a minimal SVG serializer. |

The documents come from the forecast engine,
[`@azohra/meteo.forecast`](../forecast/).

## Documentation

The guides and reference are in [`docs/`](docs/) and published at
<https://meteo.azohra.com/docs/briefing/>. Start with
[Render a first Meteogram](https://meteo.azohra.com/docs/briefing/render-first-meteogram/).
JSON Schema artifacts are in [`schema/`](schema/).

## Stability

The package is pre-1.0. Published site-forecast documents carry
`schemaVersion: 2` (the `Mps` suffix grammar and `seaLevelPressureHpa`). The
TypeScript API follows the platform versioning policy in
[`docs/versioning.mdx`](docs/versioning.mdx).

MIT © Justin Watts
