# Wire contract artifacts

The station capability's wire contract in language-neutral form: JSON
Schemas emitted from the zod contract (`station/contract.ts`), plus two
annotated example documents. Never edited by hand — regenerate with
`pnpm schemas` at the workspace root, which must reproduce every file
byte-identical (the drift guard is this package's own test suite).

They are committed rather than build-generated so contract changes appear
as reviewable diffs, and they ship in the npm tarball (`files` lists this
directory, exported as `@azohra/meteo.station/schema/*.json`) so non-JavaScript
consumers can validate against them without a TypeScript build. Every
schema carries a `$id` under `https://meteo.azohra.com/schema/`, and the
site build publishes this directory at those URLs.
