# @azohra/meteo.grib

## 0.1.3

### Patch Changes

- 6e9651d: `createNodeJ2kDecoderPool` workers no longer inherit `--input-type` from
  the host process. Node rejects that flag for file-entry workers
  (ERR_INPUT_TYPE_NOT_ALLOWED), so a host started via
  `node --input-type=module -e` could never spawn the pool; the workers'
  execArgv now drops the flag — either spelling — and keeps the rest.

## 0.1.2

### Patch Changes

- fbb7e9a: Parse the idx tokens past the forecast field into `IdxRecord.qualifier`,
  and let `findRecord` select by an optional qualifier. RRFS-SD publishes
  smoke and dust under identical variable/level/forecast triples, so species
  selection needs the qualifier to be deterministic.

## 0.1.1

Initial release: GRIB2 in pure TypeScript. Rotated and Lambert grids,
complex packing, multi-field messages, NOMADS `.idx` helpers; decoded
values exact against ecCodes golden fixtures. Sampled decodes run through
`@azohra/meteo.j2k`'s region decode, which reads only the codeblocks the
requested gridpoints touch and is bit-identical to the full decode at
those points.
