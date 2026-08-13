# @azohra/meteo.grib

## 0.1.1

Initial release: GRIB2 in pure TypeScript. Rotated and Lambert grids,
complex packing, multi-field messages, NOMADS `.idx` helpers; decoded
values exact against ecCodes golden fixtures. Sampled decodes run through
`@azohra/meteo.j2k`'s region decode, which reads only the codeblocks the
requested gridpoints touch and is bit-identical to the full decode at
those points.
