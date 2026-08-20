---
"@azohra/meteo.j2k": minor
---

New export `probeSiz`: a cheap SIZ header probe returning `bitsPerSample`, `isSigned`, and `componentCount` without decoding — the seam GRIB's codec router needs so no other package carries the SIZ byte layout. Internally, the DC level shift and range clamp now live in one `sampleRange` helper shared by `finishTile` and the region decoder, the pair whose agreement keeps region decodes bit-identical to full decodes.
