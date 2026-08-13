# Committed sample dataset

One real HRDPS continental run (`referenceTime` 2026-08-12T12:00:00Z),
captured by the engine over the three synthetic sites in
[`scenarios/catalog/`](../../../scenarios/catalog/) and served at
`https://meteo.azohra.com/data-sample/`. Captured engine output —
regenerate, never hand-edit
(`briefing/test/data-sample-contract.test.ts` holds every document to the
published contract guards).

## How it was generated

```sh
pnpm --dir forecast build
node forecast/dist/cli.js forecast build --model hrdps-continental \
  --sites scenarios/catalog/sites.json --output site/public/data-sample --max-steps 8
```

`models.json` is `meteo forecast catalogue --output`, `runs.json` is
`meteo forecast runs-index --output` over the captured manifest, and
`sites.json` and `site-context.json` are verbatim copies from
`scenarios/catalog/`.
Re-running captures a newer run, so regeneration replaces the sample
rather than reproducing it.

## The eight-step truncation

`--max-steps 8` is deliberate: HRDPS continental publishes 48 hourly
steps, and the sample keeps hours 1–8 as a small demonstration miniature. It
demonstrates every document shape; it is not the model's horizon.

## Attribution

Derived from ECCC HRDPS source data used under the
[Environment and Climate Change Canada Data Server End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/);
derived output retains that attribution requirement.
