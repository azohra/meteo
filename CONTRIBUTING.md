# Contributing to meteo

meteo welcomes focused fixes and additions that strengthen its published
contracts, meteorological methods, or documentation. For a substantial change,
open an issue first so the approach can be settled before code is written.

## Set up the workspace

Install [mise](https://mise.jdx.dev/), clone the repository, and run:

```sh
mise run setup
```

mise supplies the pinned toolchain. The setup task installs workspace
dependencies, Chromium for the browser suite, and the repository's pre-commit
check.

## Prove a change

Run the narrowest useful task while working. These root tasks cover the common
feedback loops:

```sh
mise run lint       # formatting and linting
mise run content    # documentation links, structure, and typography
mise run test       # shell and package test suites
mise run check      # the complete repository proof
```

`mise tasks ls` lists the available root tasks. Before committing,
`mise run check` must pass. GitHub Actions runs the same proof on pull requests
and pushes to main.

Tests must be deterministic. Use committed provider fixtures, fixed clocks,
explicit time zones, and synthetic scenarios. Keep network checks and live
provider probes separate from the test suite.

## Change the source, not its output

Several committed files are generated. Edit their source and run the owning
task:

| Output | Source | Task |
| --- | --- | --- |
| JSON Schemas | Package contracts and schema tables | `mise run schemas` |
| Synthetic forecast profiles and index | `scenarios/definitions/`, catalogue inputs, and the forecast generator | `mise run scenarios:generate` |
| Documentation figures and social images | Figure generators, authored SVG sources, and scenario profiles | `mise run figures` |
| Station documentation assets | Station components, styles, and asset generator | `mise run station-assets` |

Generated package output in `dist/`, the built site, and the committed sample
dataset are also derived artifacts. Do not patch them to hide drift.

Golden SVG failures ask for review, not automatic acceptance. Inspect geometry,
labels, units, stable IDs, colour meaning, and accessibility before updating a
snapshot. Unrelated golden churn usually points to an unstable input.

## Keep the contracts clear

- Treat missing provider data as absent. Never turn it into zero.
- Keep observations distinct from forecasts, provider values from derivations,
  and chart reading from a decision about whether to fly.
- Put units, freshness, uncertainty, attribution, and material limitations next
  to the value they qualify.
- Validate data where it enters the system. Internal layers should rely on the
  parsed contract.
- Keep data and derivation code independent of renderers.
- Update implementation, tests, generated artifacts, and affected prose in the
  same change.

## Write documentation that stays true

Give each fact one authoritative home and link to it elsewhere. Verify commands,
links, package names, provider claims, and current behaviour before committing.
Date measurements and provider checks. Avoid hard-coded inventories that will
go stale when the workspace grows.

The logbook records dated investigations. Living contracts and current provider
facts belong in reference documentation. Examples should run as written against
committed fixtures whenever possible.

Use straight quotes in repository prose. Keep headings in sentence case and use
the vocabulary already established by the relevant package documentation. The
[brand guide](BRAND.md) covers product naming, audience, visual boundaries, and
scientific language.

## Package changes

Published packages version independently. Add a changeset when a change affects
a package's public API or behaviour:

```sh
pnpm exec changeset
```

Name every affected package and write the short consumer-facing entry that
belongs in its changelog. Documentation-only, test-only, and internal refactors
usually need no changeset.

Maintainers publish pending changesets with `mise run release`. The verb runs
the complete proof before publishing package versions and tags.

## Submit the change

Keep commits focused and write their subjects as plain imperatives. A pull
request should explain the user-visible change, identify the proof that passed,
and include a changeset when the published surface moved.
