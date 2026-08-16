---
"@azohra/meteo.briefing": minor
---

Add four meteogram scene options.
  
  `svgHeightPx` fits the whole chart to a known panel height: the scene
  solves the plot-panel height from its own strip-stack and label geometry
  so `scene.height` equals the target exactly, across every strip
  permutation. It takes precedence over `plotHeightPx`, as `widthPx` does
  over `columnWidthPx`, and the panel never solves below 1 px, so an
  impossible target overflows instead of inverting.
  
  `HourSampling` gains two per-hour facts consumers kept re-deriving:
  `cloudCapped` (the published usable-lift top reaches the published cloud
  base; null while the hour has no lift top, never false-by-default) and
  `capeCapped` (the CAPE strip's CIN-cap dimming; null when the model
  publishes no CAPE or no CIN — the HRDPS family carries CAPE with no CIN,
  and that absence must not read as "no cap"). Each is one computation the
  strip cells and the sampling row both consume.
  
  `verticalVelocity` gains a suppression gate. Pass the model's
  declared capabilities (`options.capabilities`, the `models.json`
  catalogue entry's object) and the field is suppressed when fewer than 3
  declared omega levels sit inside the altitude window; RDPS declares
  omega at 850 and 700 hPa only, and a high site's floor prunes the lower
  one. The scene records the suppression in `scene.suppressed`
  (`{ key, reason }`), and `buildKeySpec` never advertises a suppressed
  field because it reads only what was drawn.
  
  `launchWindows` marks each hour's surface wind against the consumer's
  launch-wind arcs (meteorological FROM bearings; arcs may wrap 360, e.g.
  `{ fromDeg: 315, toDeg: 45 }`). A judgment parameter with no default:
  omit it and nothing draws. Given arcs, `scene.windWindow` carries one
  `WindWindowMark { hourIndex, x, inWindow }` per hour, the reference
  renderer draws a thin marker row above the hour labels (filled triangle
  in, open circle out, so the states differ by shape as well as colour;
  `meteo-gram-wind-window-in`/`-out`, themed by the new
  `--meteo-gram-wind-window-*` tokens), and the key gains a `windWindow`
  entry.
