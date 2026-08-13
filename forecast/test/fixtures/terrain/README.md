# Terrain math fixtures

Each fixture pins a real streamed COG window (values, mask, window
placement, pixel-centre vectors) **together with** the retired Python
implementation's outputs for it — bilinear elevation, Horn
slope/aspect, relief discs, land-cover composition, projected-CRS point
sampling — so `forecast/test/terrain-fixtures.test.ts` proves the
ported math against the production Python numbers without a network.

- `glo30-dundee.json` — `terrain_from_window` on a real GLO-30 window
- `worldcover-dundee.json` — `land_cover_from_window` on a real
  WorldCover window
- `projected-points.json` — `rasterio.warp` point transforms and
  `_projected_point` on real MRDEM-30 and LidarBC 5×5 windows

Generated 2026-08-11 from the live endpoints by
`generate_fixtures.py`, a rasterio-based script that retired with the
Python pipeline (it lived beside these fixtures; its docstring and
invocation are preserved in this branch's history). The committed
bytes are the frozen ground truth: they pin the TypeScript port to the
numbers production actually published, and regenerating them would
re-derive the Python side from a tree that no longer exists. If the
fixtures ever need to grow, the live regeneration gate
(`TERRAIN_LIVE=1`, `forecast/test/terrain-regenerate.test.ts`) — which
reproduces the committed `scenarios/catalog/site-context.json` byte-for-byte
from the live COGs — is the modern oracle.
