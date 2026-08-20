---
"@azohra/meteo.grib": patch
---

One decode core: the sync and async field decoders share `unpackField`, which unpacks every non-J2K template and hands DRT 5.40 back as a decode job, so the DRT dispatch, the constant-field check, and the bitmap coverage guard exist once. The GRIB scaling coefficients derive in one `scalingOf` instead of four call sites, the Lambert cone constant is imported from `lambertConeConstant` instead of recomputed in the nearest-gridpoint inverse, and the worker's hand-parsed SIZ knowledge (with its unreachable 31-bit ceiling) is delegated to `@azohra/meteo.j2k`'s new header probe. Decoded bytes are identical.
