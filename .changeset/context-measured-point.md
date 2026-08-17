---
"@azohra/meteo.briefing": minor
---

site-context.json v3: every entry now carries the `point` it was measured at, required on the wire. The point is the catalogue value echoed verbatim at generation time; it records the measurement's provenance and serves as the staleness test (a catalogue that has moved off it means regenerate). This is the first two-link guard chain: v2 documents parse forever and normalize up with `point` absent (stale, not invalid). The normalized `SiteContext`/`SiteContextEntry` types carry the optional point and the document's own `schemaVersion`.
