---
"@azohra/meteo.briefing": minor
---

`pathYAtX` on the scene subpaths: y of a drawn series line at an arbitrary x, inverting the exact cubic the serializer strokes (the control-point formula is now defined in one place) with `pointPath`'s null-splitting. Consumers drawing continuation stubs or cursor anchors against a series no longer need to mirror the curve math.
