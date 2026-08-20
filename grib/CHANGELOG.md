# @azohra/meteo.grib

## 0.1.4

### Patch Changes

- 938b27f: One decode core: the sync and async field decoders share `unpackField`, which unpacks every non-J2K template and hands DRT 5.40 back as a decode job, so the DRT dispatch, the constant-field check, and the bitmap coverage guard exist once. The GRIB scaling coefficients derive in one `scalingOf` instead of four call sites, the Lambert cone constant is imported from `lambertConeConstant` instead of recomputed in the nearest-gridpoint inverse, and the worker's hand-parsed SIZ knowledge (with its unreachable 31-bit ceiling) is delegated to `@azohra/meteo.j2k`'s new header probe. Decoded bytes are identical.
- Updated dependencies [938b27f]
  - @azohra/meteo.j2k@0.2.0

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
