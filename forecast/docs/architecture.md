---
title: Forecast architecture
description: Follow provider bytes through sampling, derivation, rounding, current publication, and append-only history.
---

`@azohra/meteo.forecast` exposes the `meteo` CLI (`pnpm exec meteo`, or
`node forecast/dist/cli.js` from a workspace checkout) and the versioned
documents it writes as its supported interface.

![A five-stage sequence across three actors: an upstream provider publishes a forecast cycle; the forecast engine probes completeness, builds each model, and publishes once across the static-dataset boundary; the browser reads manifest and profile and exposes a torn pair as stale.](figures/publication-flow.svg)

Inside the builder stage, provider bytes move through module-owned steps:

![A pipeline flowing top to bottom inside the builder stage. A configuration node, models.json plus sites.json, feeds a three-step row: provider transport owned by providers/transport.ts, gridpoint sampling owned by the datamart and NOAA clients with the grib decoder, and source-shaped hours assembled by the builders on their common skeletons. The hours descend to the accented deriveSiteForecast step in derive.ts, then to contract rounding and validation tests in publish.ts and builders/publication.ts, which fans out to the three published artifacts: the per-site profile under sites/, manifest.json, and the append-only monthly gzip history archive.](figures/builder-stage.svg)

## Responsibility by module

| Area | Repository home | Responsibility |
| --- | --- | --- |
| CLI and scoped paths | `forecast/src/cli.ts`, `forecast/src/config.ts` | Select model(s), validate site/output paths, cap forecast steps (`--max-steps` caps every model, GOES granules included), dispatch safely; configuration is passed explicitly, never held in ambient state |
| Site catalogue | `sites.ts` | Load the versioned, identity-only site envelope; reject shapes the loader does not speak |
| Provider transport plumbing | `providers/transport.ts` | One User-Agent, one request timeout, and the download telemetry manifests publish |
| Provider clients | `providers/datamart.ts`, `providers/noaa.ts`, and the workspace's `@azohra/meteo.grib` decoder | Fetch, range-read, decode, sample, and account for transport work |
| Published-dataset reads | `dataset.ts` | Read what is already published (public HTTPS via `METEO_DATA_BASE`, or the bucket directly when upload credentials are present) to gate rebuilds and seed history |
| Builder registry | `builders/registry.ts` | Catalogued model slug → options-only build entry, in exact model-catalogue order; each factory imports its builder module (dynamic `import()`) only when a build runs |
| Builder helpers | `builders/common.ts` | The machinery every build composes identically: forecast-slot timestamps, the bounded fetch pool, source-hour and level skeletons |
| Builders | `builders/*.ts` | Verify run completeness, request declared fields, preserve absence, assemble source hours |
| Shared field science | `moisture.ts`, `sentinel.ts` | Inverse-Magnus dew-point depression for models that publish only RH; masking of ECCC's "not computed" CAPE/CIN sentinels |
| Derivation | `derive.ts` | Produce published profile blocks and model-dependent derived values; the usable-lift derivation is imported from `@azohra/meteo.briefing/derive` and stored at the 1 m/s sink |
| Ensemble aggregation | `ensemble.ts` | Aggregate member profiles, including circular wind and censored counts |
| Publication | `publish.ts` | Round contract fields, write JSON, append gzip history, build run index |
| History mechanics | `history.ts` | Split gzip members, recompute each month's [sidecar byte-offset index](/docs/briefing/history-archives/#the-sidecar-index) after every append |
| Site context | `terrain.ts` | One-shot `site-context.json` enrichment (elevation, slope/aspect, relief, land cover); the geospatial stack loads only when the `terrain` command runs |
| Teaching scenarios | `scenario/` | Generate fixed inputs through the same derivation authority; source-checkout tooling, not engine surface |

## Authority boundary

Which quantities the forecast engine owns and which belong to `@azohra/meteo.briefing`
(including the one parameterized exception) is defined once in the
[project overview](/docs/#who-owns-each-value). The
[Meteogram derivations](/docs/forecast/derivation-science/) define the
engine's equations, constants, fallbacks, and renderer-only transformations.

The [builder contract](/docs/forecast/builder-contract/) defines the required
inputs, validation, and publication behaviour for model modules.
