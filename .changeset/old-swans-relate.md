---
"@azohra/meteo.station": minor
---

The shipped station JSON Schemas are regenerated with zod 4.6. Nullable fields are written as a type array (`"type": ["string", "null"]`) instead of an `anyOf` of single-type branches, and `stationclimatology`, `stationhistory` and `stationlive` move their root definition under `$defs` behind a root `$ref`. Both forms accept and reject the same documents, but tooling that reads the schema structure, such as a code generator, sees a different shape. The zod floor rises to `^4.6.7`, which fixes GHSA-mrhx-c7xc-m3w5.
