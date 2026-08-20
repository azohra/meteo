---
"@azohra/meteo.briefing": patch
---

History sidecar indexes now parse per-member instead of all-or-nothing: `parseHistoryIndexJson` accepts the writer's full stamped shape (multi-line and observation members included), skips only entries it cannot place, honors `schemaVersion` (refusing a version it does not know), and the Range fast path skips only members the index proves older than `since` — an archive holding a multi-line or observation member no longer loses the fast path. Internal deduplication behind it (one gzip member walk, shared altitude axis, palette, XML kernel, wall-clock resolver) leaves rendered SVG output byte-identical; the writer-side `Member` type is renamed to the shared `HistoryArchiveMember` (`offset`/`length` → `byteOffset`/`byteLength`).
