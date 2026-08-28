# Wire contract artifacts

The forecast capability's wire contract in language-neutral form: JSON
Schemas emitted from the zod contract (`@azohra/meteo.briefing/contract`).
Never edited by hand — regenerate with `mise run schemas` at the workspace
root, which must reproduce every file byte-identical (the drift guard is
this package's own test suite).

They are committed rather than build-generated so contract changes appear
as reviewable diffs, and they ship in the npm tarball (`files` lists this
directory, exported as `@azohra/meteo.briefing/schema/*.json`) so installed
consumers — any non-JavaScript reader of a
published dataset's documents — can validate against them
without a TypeScript build. Every schema carries a `$id` under
`https://meteo.azohra.com/schema/`, and the site build publishes this
directory at those URLs. The wire's versioning terms are in
[`../docs/contract.mdx`](../docs/contract.mdx).
