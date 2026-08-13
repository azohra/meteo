# forecast/test

Test files are named for the module they pin: `derive.test.ts` is the
spec for `src/derive.ts`, `builders/gfs.test.ts` for
`src/builders/gfs.ts`, `scenario-rng.test.ts` for `src/scenario/rng.ts`,
and so on. The exceptions are gate files, named for the gate they enforce
because the file is the gate rather than one module's spec:
`pipeline-parity.test.ts` (the cross-language derivation fixture) and
`terrain-regenerate.test.ts` (the `TERRAIN_LIVE=1` regeneration oracle)
here, with `golden.test.ts` (grib, j2k) and the data-sample contract
suite (forecast) holding the same role elsewhere in the workspace.
`helpers/` is shared plumbing vitest never collects; `fixtures/` is
frozen data, each directory carrying its own provenance README.
