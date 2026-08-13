---
title: Add a forecast model
description: Verify a feed, declare its capabilities, implement transport and builder behaviour, then prove the declared capabilities match the builder.
---

A model is ready only when verified provider facts, catalogue declarations, builder
behaviour, fixtures, and published documentation agree.

> **Caution — verify before code.** Provider fields, levels, semantics,
> sentinels, packing, schedules, domains, and access limits are facts that can
> change. Verify them against the live feed first and record a dated
> `[verified YYYY-MM-DD]` entry in the living forecast feed reference. Prior
> notes and community folklore are hypotheses, not sources.

1. **Record the provider evidence.** Update
   `forecast/docs/forecast-model-feeds.mdx` with source paths, exact field/level
   identifiers, timing, semantics, sentinels, packing, domain, limits, and
   licence or attribution obligations. Propose substantive prose rewrites to
   the author; add only the verified facts your model needs.
2. **Declare the model.** Add one entry to the right array in `models.json`
   (`models`, `smokeModels`, or `observationModels`). Slug is the
   identity; declare cadence, grid, horizon, deterministic/ensemble kind,
   experimental status, and every capability or absence exactly.
3. **Choose a transport.** Reuse the relevant Datamart or indexed NOAA
   primitives when the feed matches; add a new transport boundary only when
   its request, packing, or sampling model genuinely differs. If the feed
   needs a grid or packing template `@azohra/meteo.grib` does not yet decode, that
   decoder work lands first, gated by its own ecCodes golden fixture.
4. **Build source-shaped hours.** Normalize units, winds, intervals, and
   optional fields while preserving absence. Pass verified per-document
   semantics into the shared derivation.
5. **Publish through shared utilities.** Compose `builders/common.ts` and the
   shared `derive.ts`/`publish.ts` tail — run selection, profile derivation,
   document publication, and the manifest — rather than open-coding it;
   shared rounding, history, and run-index conventions come with it.
6. **Register the builder.** Add one entry to the registry in
   `forecast/src/builders/registry.ts` — slug → options-only factory,
   importing the builder module inside the factory (dynamic `import()`) so
   the CLI stays free of its heavy dependencies; the registry test requires
   exact catalogue order. Add a scheduled invocation only when the model is
   ready to publish.
7. **Prove the declaration.** Add focused fixture-based tests in
   `forecast/test/builders/<model>.test.ts` for run selection, URLs/records,
   conversion, sentinels, domain guards, optional fields, semantics, output
   paths, and error handling. Assert catalogue capability parity.
8. **Update affected writing.** Keep the model capability guide and provider
   reference true. Add a logbook entry only if the work yields a genuine
   dated result, not merely because a model was added.

Do not place a model in a frontend list, infer behaviour from its slug, or
borrow capabilities from a similar system. A model exists for consumers when
the catalogue declares it.

Run the focused builder tests, then the full repository
gates. A provider smoke run is an explicit
network operation performed only after fixture tests and review.
