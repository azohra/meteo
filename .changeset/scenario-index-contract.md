---
"@azohra/meteo.forecast": minor
---

The scenario-index shape becomes a zod contract owned by the forecast package (`src/scenario/contract.ts`), exported at the new `@azohra/meteo.forecast/contract` subpath. `scenarios/index.schema.json` is now emitted from that contract by `pnpm schemas` and held by a byte-compare test, the generator validates and types the index through the contract instead of ajv over a hand-written schema, and the site's scenario registry reads `scenarios/index.json` through `parseScenarioIndex()` in place of its own hand parsers. The generated `scenarios/index.json` is byte-for-byte unchanged.
