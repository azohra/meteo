---
"@azohra/meteo.station": minor
---

The source's own step digests reach the wire, vendor-neutral and additive (schemaVersion stays 2). An ok `Station` gains nullish `recentSummaries` — a list of `RecentSummary` blocks (`{ windowMinutes, stepMinutes, points }`, reused `HistoryPoint`s, oldest first, empty steps absent), gated by the new nullish `recentSummaries` capability key; the live stream gains a `summaries` frame that replaces the block whole. The WindNerd adapter declares the capability and fills it from the digest's ten 1-minute and twelve 5-minute blocks (`parseWindnerdRecentSummaries`, exported), on the current document and on every `LAST_DIGEST`. The live store folds `summaries` frames into its snapshot without disturbing the samples ring, and `mergeCurrent` keeps a fresher live-folded block over a current that carries none — provenance is never mixed. Not derivable client-side: the samples ring covers only ~10 minutes.
