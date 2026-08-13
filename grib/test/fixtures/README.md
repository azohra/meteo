# GRIB2 golden-fixture corpus

Single-message GRIB2 files harvested from the live provider feeds the
retired Python pipeline consumed, paired with ecCodes-derived expectation sidecars. The
corpus exists to validate the TypeScript GRIB2 decoder against ecCodes
(2.48.0): for every fixture, a decoder that reproduces the sidecar's
`values.sha256` (the decoded array serialized as little-endian float64),
statistics, samples, and nearest-gridpoint results is bit-for-bit compatible
with ecCodes on that message.

## Files

- `<name>.grib2` — raw single-message bytes. Stacked ensemble files
  (REPS/GEPS `allmbrs`) were split with the Python pipeline's `split_messages` and
  only the named member kept. `nam-uv-10m.grib2` is deliberately a
  **two-submessage** NCEP paired-wind message (idx lines `N.1`/`N.2` at one
  byte offset); its sidecar carries a `fields` array with one block per
  submessage.
- `<name>.expect.json` — provenance (`source`: exact URL, byte range and
  .idx line for ranged NOAA reads, harvest timestamp, referenceTime/step),
  `gridMeta` (ecCodes keys: grid/packing templates, scanning mode, grid
  geometry, projection/rotation keys, level, time, DRT detail), `values`
  (sha256 + count/missingCount/min/max/mean + 200 evenly spread
  `[index, value]` samples, plus a few known-missing indexes on bitmapped
  fields), and `sites` (ecCodes `codes_grib_find_nearest` for every site in
  `sites.json` here; out-of-domain sites record an `error` instead).
- `manifest.json` — ecCodes version, harvest date, file list with sizes,
  `oversized` (> 8 MB), `gaps` (providers skipped), and measured `findings`.
- `sites.json` — a **frozen** copy of the site catalog exactly as it stood
  at harvest time (2026-08-11). The `sites` blocks in every sidecar are
  ecCodes 2.48.0's nearest-gridpoint answers at these exact coordinates, so
  the coordinates are part of the golden data, not a live catalog. The real
  catalog lives with the operator and may change freely — a club adding,
  moving, or removing sites must never break a generic decoder's parity
  suite. Never edit this file or re-point the suite at a live catalog; the
  harvester and most of its sources are gone, so the expectations cannot be
  recomputed.

Floats are serialized with Python `repr` semantics (default `json.dumps`),
so they round-trip exactly.

## How it was generated

By the harvester that lived in the Python pipeline
(`python/tools/harvest_grib_fixtures.py`, run as
`uv run --project python python python/tools/harvest_grib_fixtures.py`)
and was retired with it — the committed corpus is the frozen ground truth.

The script was idempotent per fixture name (re-running overwrote) and reused
the Python pipeline's own modules for URLs, schedules, and transport
(`azohra.meteo.forecast.datamart`, `.noaa`, `.grib`, and the
`builders.*` per-model logic).

## Regeneration caveat

The ECCC Datamart (`dd.weather.gc.ca`, and `dd.alpha.weather.gc.ca` for
HRDPS West 1 km) keeps roughly **one day** of files: the `source.url` of
every ECCC fixture expires within ~24 h of harvest and cannot be re-fetched
afterwards — re-running the script harvests a *newer run*, producing
different bytes and hashes. NOAA's Open Data S3 buckets
(`noaa-gfs-bdp-pds`, `noaa-hrrr-bdp-pds`, `noaa-nam-pds`) retain files for
much longer, so the NOAA `source.url` + `byteRange` pairs stay directly
re-fetchable. The committed bytes are therefore the ground truth; the URLs
are provenance, not a reproduction recipe. NAM (both products) retires
2026-10-06 in favour of RRFS.

## Coverage

| Fixture | Model | Grid template | Packing (DRT) | Bitmap | Multi-field | Covers |
| --- | --- | --- | --- | --- | --- | --- |
| gfs-tmp-850mb | GFS 0.25° | 3.0 regular lat-lon | 5.3 complex + spatial differencing | – | – | temperature at isobar |
| gfs-ugrd-850mb / gfs-vgrd-850mb | GFS 0.25° | 3.0 | 5.3 | – | – | U/V pair — stored as **separate** idx records in pgrb2.0p25 |
| gfs-shtfl-ave-0-6h | GFS 0.25° | 3.0 | 5.3 | – | – | growing-window flux average (`0-6 hour ave fcst`) |
| hrrr-tmp-850mb | HRRR CONUS 3 km | 3.30 Lambert conformal | 5.3 | – | – | Lambert grid |
| nam-uv-10m | NAM 12 km (awphys) | 3.30 Lambert | 5.3 | – | **2 submessages** | NCEP paired U/V (idx N.1/N.2, one offset) |
| nam-tmp-850mb | NAM 12 km | 3.30 Lambert | 5.3 | – | – | plain awphys record (AWIPS grid 218) |
| nam-nest-tmp-bitmap | NAM CONUS nest 3 km | 3.30 Lambert | 5.3 | **76 / 1,905,141 masked** | – | sparse bitmap |
| hrdps-continental-tmp-2m | HRDPS 2.5 km | 3.1 rotated lat-lon | 5.40 JPEG2000 | – | – | rotated grid + JPEG2000; forecastTime in **minutes** (unit 0) |
| hrdps-west-tmp-2m | HRDPS West 1 km | 3.1 rotated | 5.40 | – | – | experimental 1 km rotated grid (alpha Datamart) |
| rdps-tmp-2m | RDPS 10 km | 3.1 rotated | 5.40 | – | – | RDPS rotated grid |
| gdps-tmp-2m | GDPS 15 km | 3.0 regular 0.15° | 5.40 | – | – | regular lat-lon + JPEG2000 |
| reps-tmp-2m-m00 / m01 | REPS 10 km | 3.1 rotated | 5.40 | – | – | first two members of a stacked all-members file (perturbationNumber 0/1) |
| reps-ugrd-10m-m00 / reps-vgrd-10m-m00 | REPS 10 km | 3.1 rotated | 5.40 | – | – | member-0 U/V pair, grid-relative (uvRelativeToGrid=1) — wind-rotation validation |
| geps-tmp-2m-m00 / m01 | GEPS 0.5° | 3.0 regular | 5.40 | – | – | first two members of a stacked file (720×361) |
| geps-orog-m00 | GEPS 0.5° | 3.0 regular | 5.40 | – | – | surface orography — the **decametre landmine**: values are dam despite metadata claiming metres (max 586.3 ⇒ ×10 for metres) |
| raqdps-pm25-sfc | RAQDPS 10 km | 3.1 rotated 0.09° | 5.40 | – | – | PM2.5 field, kg/m³ (no units metadata in the GRIB) |

### Measured findings (previously open questions)

- **NOAA packing**: every harvested GFS, HRRR, and NAM record (both parent
  and nest, all variables tried) uses **DRT 5.3 —
  `grid_complex_spatial_differencing`** (complex packing with second-order
  spatial differencing). No NOAA record in this corpus uses 5.0 or 5.40.
- **GFS U/V storage**: pgrb2.0p25 stores UGRD and VGRD as **separate idx
  records at distinct byte offsets** — unlike NAM, whose UGRD/VGRD are two
  submessages of one message at a shared offset.
- ECCC (Datamart) products all use **DRT 5.40 JPEG2000** (`grid_jpeg`),
  on rotated (3.1) or regular (3.0) lat-lon grids, with
  `uvRelativeToGrid=1` on every rotated grid.

## Beside the corpus: rdps-cape-sfc-jasper

This pair arrived after the corpus froze and answers to a different
oracle, so it is deliberately **not** listed in `manifest.json`: the
golden suite's enumeration stays the twenty-message ecCodes corpus above,
and the suites that gate this fixture (`grib/test/j2k-golden.test.ts`,
`j2k/test/jasper.test.ts`) name it directly.

RDPS `CAPE_Sfc` PT001H from the 2026-08-12 12Z run (Datamart URL in the
sidecar; Datamart files expire within ~24 h, so the committed bytes are
the provenance). Discovered by the rdps live smoke the day @azohra/meteo.j2k
became the production codec: most ECCC fields are OpenJPEG-encoded, but a
few — this one's COM marker says "Creator: JasPer" — differ in three
load-bearing ways from every fixture in the golden corpus:

- **Bitmapped one-row geometry**: the coded values are flattened to an
  813275x1 image (section 6 bitmap; the grid is 1140x1045).
- **Multiple precincts**: 813275 exceeds the default 2^15 precinct, so
  the upper resolutions honestly have several precincts (25 at r=5) and
  the one-packet-per-resolution degeneracy breaks — this fixture is why
  `packets.ts` walks the precinct grid.
- **Tile-part QCC**: quantization is restated in the tile-part header
  with DIFFERENT subband exponents than the main QCD (Mb per band changes
  — mis-honoring it mis-decodes every codeblock), and 24-bit samples —
  deeper than the 20-bit RAQDPS corpus fixture.

The sidecar's sha256 answers were recorded 2026-08-12 from a decode
verified sample-for-sample (813275 of 813275 equal, and likewise for the
sibling `CIN_Sfc` field of the same run) against `OpenJPEG.js` 0.10.2 —
the independent asm.js OpenJPEG build that carried >16-bit fields before
its retirement, installed out-of-tree for the verification. The
`decodedField` sha is over the little-endian float64 bytes of
`decodeFieldValues`' output, the same encoding as the ecCodes corpus
sidecars.
