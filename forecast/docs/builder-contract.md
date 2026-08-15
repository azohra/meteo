---
title: Builder contract
description: The invariants every deterministic and ensemble model builder must preserve.
---

This page is for someone **writing or reviewing a builder module** — an
operator running the CLI never needs it (the errors a failed build prints
are quoted in [Run one model](/docs/forecast/run-one-model/#when-a-build-fails)).

A builder translates one verified provider feed into the shared source shape,
then delegates profile derivation and publication. It does not redefine the
public JSON shape or renderer behaviour.

## Required invariants

1. **Catalogue agreement.** The slug, kind, levels, cadence, horizon,
   capability presence, and field semantics match `models.json`.
2. **Complete-run selection.** A builder selects a provider run only after its
   declared final product is available, and skips an already-published
   `referenceTime` without rewriting output.
3. **Domain honesty.** A sample too far from a site signals out-of-domain
   clamping; the build fails rather than publishing a boundary value.
4. **Unit and direction normalization.** Source values reach the profile
   contract's units and meteorological FROM-direction before publication.
5. **Absence stays absent.** Missing records, masked sentinels, and
   unsupported optional fields are omitted, never converted to zero.
6. **Semantics are supplied, not inferred.** The verified builder passes
   gust, precipitation, and (where the model carries smoke) smoke semantics
   into `deriveSiteForecast`.
7. **Derived values have one authority.** Builders supply source fields;
   `forecast/src/derive.ts` supplies `derived.*`.
8. **Publication is deterministic at the edge.** Shared rounding and JSON
   writers own precision and serialized shape.

## The shared machinery

A builder implements only what is genuinely model-specific (field tables,
URLs, and provider quirks) and composes `builders/common.ts` for the walk
every build shares. Its exports:

- `BuilderHour` and `BuilderLevel`: the source-hour and level shapes.
  `emptyHour(validAt)` seeds every numeric field with NaN so a fetch task
  that never ran leaves a value the serializer refuses;
  `isCompleteLevel(level)` requires all six level fields before a level
  publishes.
- `requiredValue(provider, value, fieldName, site)` and
  `memberRequiredValue(value, field, site, member)`: reject a missing or
  non-finite required sample by name.
- `withDewPointDepression(level)`: swaps a level's relative humidity for
  the derived dew-point depression.
- `validTime(referenceTime, forecastHour)`, `manifestInstant()`, and
  `profileInstant()`: the shared timestamp forms.
- `runConcurrent(tasks, maxWorkers)`: the bounded fetch pool.
- `maxSteps()`: the `METEO_MAX_STEPS` build cap; `KELVIN` and the
  `NamedSite` type round out the module.

Publication authority lives in `derive.ts` and `publish.ts`; a builder never
open-codes the profile, history, or manifest writes.

A semantics declaration (invariant 6) is one verified line per builder,
HRDPS West's, from `forecast/src/builders/hrdps-west.ts`:

```ts
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";

export const SEMANTICS: ForecastSemantics = { gust: "hourMax", precipitation: "instantRate" };
```

## What failure looks like

An invariant violation fails the build, never the document; the exact error
strings an operator sees are quoted in
[Run one model](/docs/forecast/run-one-model/#when-a-build-fails). Optional
declared-capability fields are the one sanctioned absence: they stay absent only where
catalogue declaration and builder behaviour agree (invariant 5).

## Source hour versus published hour

```text
builder source                     published profile
temperatureC                  ─┐   surface.temperatureC
dewPointDepressionC            ├─→ surface.dewPointC
heat fluxes + sampled levels   ├─→ derived.*
optional provider fields       └─→ optional surface/level fields
```

The source hour is internal and may carry provider-facing intermediate
names such as dew-point depression. The published contract is the stable
boundary. Do not expose a builder intermediate merely to avoid an appropriate
derivation.

## Ensemble additions

Ensemble builders derive every member independently, then aggregate matching
numeric positions. `run.members` is total membership;
`EnsembleValue.members` counts contributors at that position and can be lower
when null or censored member values are excluded. Wind direction uses circular
aggregation. Height censoring uses `ceiledMembers` only on positions where the
forecast engine records a column ceiling.

Focused builder tests should use committed fixtures or injected transport
responses. They must not require live provider access; verification establishes
facts and tests make behaviour repeatable.
