---
title: Builder contract
description: The invariants every deterministic and ensemble model builder must preserve.
---

This page is for someone writing or reviewing a builder module. An
operator running the CLI does not need it. The errors a failed build prints
are quoted in [Run one model](/docs/forecast/run-one-model/#when-a-build-fails).

A builder translates one verified provider feed into the shared source shape,
then hands profile derivation and publication to shared code. It does not
redefine the public JSON shape or renderer behaviour.

## Required invariants

1. The builder agrees with the catalogue. The slug, kind, levels, cadence,
   horizon, capability presence, and field semantics match `models.json`.
2. The builder selects only complete runs. It selects a provider run only
   after the run's declared final product is available, and it skips an
   already-published `referenceTime` without rewriting output.
3. The builder is honest about its domain. A sample too far from a site
   signals out-of-domain clamping, and the build fails instead of publishing
   a boundary value.
4. Units and directions are normalized. Source values are converted to the
   profile contract's units and meteorological FROM-direction before
   publication.
5. Absence stays absent. Missing records, masked sentinels, and unsupported
   optional fields are omitted. They are not converted to zero.
6. Semantics are supplied by the builder and are not inferred. The verified
   builder passes gust, precipitation, and (where the model carries smoke)
   smoke semantics into `deriveSiteForecast`.
7. Derived values have one authority. Builders supply source fields, and
   `forecast/src/derive.ts` supplies `derived.*`.
8. Publication is deterministic at the edge. Shared rounding and JSON
   writers own precision and serialized shape.

## The shared machinery

A builder implements only what is specific to its model (field tables, URLs,
and provider quirks). For the steps every build shares, it uses
`builders/common.ts`, which exports the following.

- `BuilderHour` and `BuilderLevel` are the source-hour and level shapes.
  `emptyHour(validAt)` seeds every numeric field with NaN, so a fetch task
  that never ran leaves a value the serializer refuses.
  `isCompleteLevel(level)` requires all six level fields before a level
  publishes.
- `requiredValue(provider, value, fieldName, site)` and
  `memberRequiredValue(value, field, site, member)` reject a missing or
  non-finite required sample by name.
- `withDewPointDepression(level)` swaps a level's relative humidity for
  the derived dew-point depression.
- `validTime(referenceTime, forecastHour)`, `manifestInstant()`, and
  `profileInstant()` produce the shared timestamp forms.
- `runConcurrent(tasks, maxWorkers)` is the bounded fetch pool.
- `parseCycleStamp(referenceTime, runHours, name)` validates a pinned cycle,
  and `runReferenceTime(run)` is its inverse.
- `KELVIN` and the `NamedSite` type complete the module.

Publication authority lives in `derive.ts`, `publish.ts`, and
`builders/publication.ts`. Every run builder hands its model-specific parts
to `publishRun`, which resolves the run, applies the already-published gate,
and owns the profile, history, and manifest writes. A builder does not
write these itself.

A semantics declaration (invariant 6) is computed from the model descriptor.
`modelSemantics` in `forecast/src/builders/eccc.ts` reads the gust pairing
and precipitation transport from the descriptor's fields, and each builder's
contract test pins the result against `models.json`. HRDPS West, for
example, resolves to `{ gust: "hourMax", precipitation: "instantRate" }`
because its descriptor names a gust-max variable and carries precipitation
as a plain surface rate (PRATE) instead of an accumulation.

## What failure looks like

An invariant violation fails the build, and no document is published. The
exact error strings an operator sees are quoted in
[Run one model](/docs/forecast/run-one-model/#when-a-build-fails). Optional
declared-capability fields are the one sanctioned absence. They stay absent
only where the catalogue declaration and builder behaviour agree
(invariant 5).

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
boundary. Do not expose a builder intermediate only to skip an appropriate
derivation.

## Ensemble additions

Ensemble builders derive every member independently, then aggregate matching
numeric positions. `run.members` is total membership.
`EnsembleValue.members` counts contributors at that position and can be lower
when null or censored member values are excluded. Wind direction uses circular
aggregation. Height censoring uses `ceiledMembers` only on positions where the
forecast engine records a column ceiling.

Focused builder tests should use committed fixtures or injected transport
responses. They must not require live provider access. Verification establishes
facts, and tests make behaviour repeatable.
