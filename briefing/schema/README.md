# Wire contract artifacts

These are the JSON Schemas for the published forecast documents, emitted
from the zod contract in `@azohra/meteo.briefing/contract`. Do not edit
them by hand. Run `mise run schemas` at the workspace root to regenerate
them; the package's test suite fails if the output differs by a byte.

They are committed so contract changes show up as reviewable diffs. They
also ship in the npm tarball (`files` lists this directory, exported as
`@azohra/meteo.briefing/schema/*.json`), so a reader in any language can
validate a published dataset's documents without a TypeScript build. Every
schema carries a `$id` under `https://meteo.azohra.com/schema/`, and the
site build publishes this directory at those URLs. The versioning rules are
in [`../docs/contract.mdx`](../docs/contract.mdx).
