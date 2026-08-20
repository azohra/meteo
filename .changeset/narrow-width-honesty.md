---
"@azohra/meteo.station": minor
---

Fix narrow-width rendering and coverage units.
  
  - Chart label rows (compass letters, averages, time captions) now thin to fit the measured width instead of colliding; arrows always draw. `VaneCell.label`/`value` are now nullable, `vaneTicks` takes a label count, and the `dailyPatternCoverage` string takes a precomputed percent.
  - Climatology coverage was denominated in the producer's fed period and could read over 100%. The year ledger gains additive `coveredSlotCount`/`expectedSlotCount`; the percent is computed only from that pair and is withheld on documents without it.
  - `<meteo-station-strip>` wraps instead of clipping in narrow columns.
