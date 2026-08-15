---
"@azohra/meteo.forecast": minor
"@azohra/meteo.briefing": minor
---

Remove the v1 migration machinery. schemaVersion 1 never existed
  publicly (it was one pre-release deployment, migrated once), so the
  `meteo forecast migrate` command, `forecast/src/migrate.ts`, and the
  briefing contract's migration exports (`migrateDocument`, `migrateHour`,
  `migrateSurface`, `migrateLevel`, `WIRE_V1_HOUR_RENAMES`,
  `WIRE_V1_DERIVED_RENAMES`, `WireDocument`, `MigrateDocumentOptions`)
  served no reader and are removed. Published documents start, and have
  always started, at `schemaVersion: 2`.
