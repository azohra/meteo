# `@azohra/meteo.briefing`

The **briefing** capability of meteo by Azohra: the published site-forecast
contract and everything that is a pure function of it (validation,
derivation, analysis, comparison across models and across a model's own
successive runs, transport, the append-only history), and the Meteogram,
the visual tier of the same science.

## Surface

| Entry point | What it is |
|---|---|
| `@azohra/meteo.briefing` | The capability root: re-exports the contract: document types, zod schemas, and never-throw parse guards for every published document kind. |
| `@azohra/meteo.briefing/contract` | The contract itself: `SiteForecast`, the smoke/observation documents, manifests, catalogues, the runs index, and their parsers. |
| `@azohra/meteo.briefing/derive` | Pure meteorological derivations of published values: lapse rates, thermal index, shear, usable-lift top at a chosen sink rate, moisture, smoke transmittance, projection, alignment, local-day helpers. |
| `@azohra/meteo.briefing/analyze` | `analyzeForecast`: typed findings over one forecast (thermal window, cap timing, wind exceedance, smoke impact, and the rest of the closed vocabulary), plus the public `AnalysisFrame` for caller extensions. |
| `@azohra/meteo.briefing/compare` | `compareForecasts` / `compareAnalyses`: cross-model agreement, spread, and divergence findings for one site. |
| `@azohra/meteo.briefing/transport` | Consistent loading of the published documents: run-stamp guards, retries, misses discriminated from failures. |
| `@azohra/meteo.briefing/history` | The append-only archive reader and `compareRuns` convergence: the one Node-only subpath (`node:zlib`). |
| `@azohra/meteo.briefing/meteogram` | The Meteogram tier: a renderer-independent scene graph (layout, hit-testing, key spec) and the deterministic SVG serializer with its token defaults. |

The producing side (the engine that samples providers and publishes
the documents this capability consumes) is
[`@azohra/meteo.forecast`](../forecast/).

## Documentation

The reference lives in [`docs/`](docs/) (contract, transport,
derivations, analysis, comparison, and history each have a page) and is
served at <https://meteo.azohra.com/docs/briefing/>.
JSON Schema artifacts live in [`schema/`](schema/).

## Stability

Pre-1.0: the wire contract is wire v2 (`schemaVersion: 2`: the `Mps`
suffix grammar and `seaLevelPressureHpa`; stored v1 documents migrate
through the forecast engine's `meteo forecast migrate`); the TypeScript
surface follows the platform versioning policy in
[`docs/versioning.mdx`](docs/versioning.mdx).

MIT © Justin Watts
