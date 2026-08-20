# Synthetic scenarios

This directory holds deterministic recipes for model-shaped forecast data:
the platform's reviewed synthetic corpus and the read side's regression
goldens. The resulting profiles are synthetic and test artifacts, not
forecasts. They do not describe present conditions, past conditions, or
expected conditions at a launch. Public figures using them must retain a
visible **Synthetic scenario** label and a useful accessibility description.

## Why control the input

Every profile here generates through the same contract a real forecast uses,
so a figure or test can hold everything steady except the one relationship it
demonstrates:

| Need | What a controlled scenario provides |
| --- | --- |
| Compare two states | Change one quantity while holding the rest steady |
| Explain uncertainty | Show deterministic and ensemble shapes side by side |
| Demonstrate absence | Omit an unsupported capability instead of substituting zero |
| Test a renderer | Regenerate the same document and expect the same scene |
| Isolate an edge case | Construct a rare but plausible pattern without waiting for it to occur |

Offline model output can calibrate plausible ranges; figures and tests
consume the fixed, committed profile. A figure built on a scenario needs a
clear relationship, a meaningful static frame, units, and an accessible
description. Add a caption when method or limits change the reading. Add
controls only when changing an input reveals something the static frame
cannot. The scenario generator and validation gates own committed
documents; prose and components consume those artifacts.

The generator enforces the distinction:

- definitions use synthetic scenario ids and one of the abstract model shapes
  in `scenario.schema.json`, never a production model slug as public identity;
- every clock instant and time zone is explicit and every definition carries a
  seed, so output cannot depend on the current date, ambient randomness, or a
  machine-local time zone;
- baselines are repository-local JSON files, so generation performs no network
  access;
- definitions and baselines contain source values only;
- the forecaster's derivation (`deriveSiteForecast` in `forecast/src/derive.ts`)
  remains the authority for `derived.*` values;
- generated profiles are committed for reproducible rendering, but they are
  never edited by hand.

## Directory contract

```text
scenarios/
├── scenario.schema.json        definition schema and closed vocabulary
├── catalog/                    the three synthetic sites the platform's
│                               examples and sample dataset build from
├── definitions/                one discoverable recipe per top-level JSON file
│   └── invalid/                rejection fixtures, never discovered as scenarios
├── baselines/                  source-shaped inputs and provenance records
├── generated/                  generated profile documents; do not hand-edit
└── index.json                  generated public registry
```

The scenario runner discovers only
`scenarios/definitions/*.json`. Files below `definitions/invalid/` are test
fixtures. The runner resolves baseline paths from `scenarios/`, not from the definition
file's directory or the process working directory.

`catalog/` holds the three synthetic sites (`test-hill`, `test-ridge`, and
`test-valley`) whose `sites.json` and `site-context.json` the documentation's
examples and the committed sample dataset build from. They are the same
documents the logbook entry
[The mountain the model sees](https://meteo.azohra.com/docs/forecast/the-mountain-the-model-sees/)
reads its relief and land-cover figures from.

`index.json` is a generated registry: each entry carries the
definition's lesson metadata (including the `launch` a renderer should pass
as `MeteogramOptions.launch`), the generated output path or paths, and the
SHA-256 output hash. A definition without generated output must not be advertised
through the index.

## Definition fields

Every definition has these required fields:

- `id`, `title`, and `lesson` identify the recipe and the single relationship
  it teaches;
- `kind` is `deterministic`, `ensemble`, or `comparison`;
- `modelShape` selects a synthetic transport shape, not a named forecast model;
- `timeZone` is an explicit IANA-style zone echoed into the generated
  profile as `site.timeZone` for local-time analysis, projection, and
  presentation;
- `site.synthetic` is always `true`; the site block is sample provenance
  only; generated documents are launch-agnostic;
- `launch` declares the launch elevation the lesson teaches against. It never
  enters the generated document: the index publishes it, and renderers pass it
  as the package's `MeteogramOptions.launch`. Assertions read it as
  `launch.elevationM`. Baselines are launch-agnostic too; one carrying the
  retired `siteAltitudeM` is rejected with directions;
- `clock` fixes the UTC reference, generation, and first-valid instants,
  sampling step, hour count, and random seed;
- `baseline` names one local source file and, for calibrated material, its
  provenance record;
- `transforms` contains only declared source-input operations;
- `semantics` explicitly declares how synthetic gust and precipitation fields
  map to the profile contract's semantics vocabulary;
- `capabilities` uses the same field-presence vocabulary as the published model
  catalogue without claiming that a production model produced the data;
- `assertions` records machine-checkable relationships that establish the
  lesson.

The `modelShape` vocabulary:

| Shape | Structural promise |
| --- | --- |
| `hourly-rich` | Hourly levels, heat fluxes, gust, CAPE/CIN, model PBL height, and cloud layers |
| `hourly-core` | Hourly levels and heat fluxes without optional science fields |
| `three-hourly-regional` | Three-hour steps and a reduced pressure-level set |
| `ensemble-five-level` | Member-derived percentile output on exactly five pressure levels |

An ensemble definition also declares its member count and seeded source-field
perturbations. `symmetric` perturbations are balanced ranks over the declared
spread, `uniform` uses the spread as a bounded half-range, and `normal` uses it
as the standard deviation. Correlation selects one draw for the whole column,
for each scenario hour, for each pressure level, or for each individual source
position. The generator derives every member source column independently
before the resulting profiles enter the production ensemble aggregator.

A comparison declares two to four neutral variant ids; variant-specific
transforms refer to those ids through `target`. Its output filenames include
the variant id and the generated index keeps the corresponding label beside
each path. Comparison labels describe controlled differences, not correctness
or probability.

## Transform vocabulary

The schema rejects any operation outside this list:

| Type | Effect on source input |
| --- | --- |
| `surface-field-curve` | Set a declared surface field at scenario-hour offsets |
| `temperature-offset` | Offset level temperature within an MSL altitude band |
| `dew-point-depression-offset` | Offset level dew-point depression within an MSL altitude band |
| `wind-speed-scale` | Scale non-negative level wind speed within an MSL altitude band |
| `wind-direction-rotate` | Rotate level wind direction within an MSL altitude band |
| `pressure-tendency` | Apply a surface-pressure change per scenario hour |
| `capability-field` | Explicitly add or omit an optional source field |
| `time-shift` | Shift fixed profile times by a declared whole-hour offset |
| `elevation-adjustment` | Adjust the model elevation by a declared delta |

Scheduled transform numbers can be constants or `byHour` point sets. The
validator rejects duplicate or out-of-range hour offsets, inverted altitude
bands, comparison targets not declared by the definition, and capability
declarations that disagree with the resulting source shape.

Transforms cannot name a `derived.*` field. Assertions may read derived fields
because they check the forecaster's result; they do not write values.
Assertions use explicit hour indices and, for pressure-level fields, an exact
pressure or nearest-height selector. Presence assertions preserve the important
difference between an absent field and a field whose value is zero.

Ensemble positions are addressed by a trailing percentile key: a field such as
`derived.usableLiftTopM.p50` names one position inside the published percentile
block, and `.members` names its contributor count. Wind direction (a circular
median) and the level pressure coordinate publish plain numbers and take no
suffix. A nearest-height selector positions ensemble levels by their median
(`p50`) height, the same position the aggregation orders levels by.

## Baselines and attribution

A `synthetic` baseline is authored input with no claim of observational or
forecast provenance. It still uses the exact source shape `deriveSiteForecast()` accepts,
so the synthetic path exercises production derivations.

A `calibrated` baseline may be reconstructed from real provider output to keep
synthetic magnitudes and vertical relationships credible. It is calibration
material only: the website must never import it directly and public prose must
not present its timestamps as a current or historical forecast example. Its
definition must name a sibling `*.provenance.json` record containing:

- provider and model;
- model reference time and retrieval or capture date;
- source URL or feed identifier and applicable attribution or licence terms;
- site identity and coordinates used during capture;
- fields retained, fields omitted, and the reconstruction method;
- numeric tolerances introduced by reconstruction;
- the repository revision and a `[verified YYYY-MM-DD]` date for provider
  facts.

The provenance record credits the provider adjacent to any discussion of the
calibration method. Generated output continues to be labelled
synthetic and uses synthetic public identity.

At generation time the definition's `site`, `timeZone`, and `clock` replace
baseline metadata: valid times are rebuilt from `startAt`, `stepHours`, and
`hourCount`, and the zone is echoed as the profile's `site.timeZone`.
The baseline contributes the atmospheric source columns, not public identity or
time claims. The validator also rejects a scenario id that equals any slug in
the current `forecast/models.json` catalogue. The check reads the catalogue instead
of copying its slugs into this schema.

## Validation fixtures

`definitions/minimal-valid.json` is the smallest committed valid recipe. Its
source baseline contains two fixed hourly columns and no `derived` block.

The fixtures below `definitions/invalid/` each isolate a required rejection:

- `missing-lesson.json` omits `lesson`;
- `unknown-transform.json` names an operation outside the closed vocabulary;
- `invalid-clock.json` uses an unsupported two-hour cadence for an hourly
  shape;
- `direct-derived-authorship.json` attempts to transform
  `derived.thermalVelocityMps`.

Run the schema, fixture, generated-output, and registry checks together:

```sh
pnpm scenarios:check
```
