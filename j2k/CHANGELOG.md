# @azohra/meteo.j2k

## 0.1.1

Initial release: JPEG 2000 scoped to the codestream subset the weather
feeds ship, as the production codec behind `@azohra/meteo.grib`'s Node
path. `decodeJ2kRegion` decodes only the codeblocks the requested
gridpoints touch, bit-identical to the full decode at those points and
exact against the OpenJPEG and JasPer oracles.
