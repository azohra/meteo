# @azohra/meteo.j2k

## 0.2.0

### Minor Changes

- 938b27f: New export `probeSiz`: a cheap SIZ header probe returning `bitsPerSample`, `isSigned`, and `componentCount` without decoding — the seam GRIB's codec router needs so no other package carries the SIZ byte layout. Internally, the DC level shift and range clamp now live in one `sampleRange` helper shared by `finishTile` and the region decoder, the pair whose agreement keeps region decodes bit-identical to full decodes.

## 0.1.1

Initial release: JPEG 2000 scoped to the codestream subset the weather
feeds ship, as the production codec behind `@azohra/meteo.grib`'s Node
path. `decodeJ2kRegion` decodes only the codeblocks the requested
gridpoints touch, bit-identical to the full decode at those points and
exact against the OpenJPEG and JasPer oracles.
