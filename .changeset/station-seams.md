---
"@azohra/meteo.station": minor
---

Two behavior fixes at the client seams, rendered markup unchanged. In live
mode, `useStation`'s `refresh` now restarts the SSE stream for a fresh init
frame (the hook wraps `createStationStore` instead of re-deriving it); it
previously only re-kicked the pollers, so a live view could not force a
reconnect. The live store now carries the sample cadence from the wire:
`StationLiveSnapshot` gains `sampleIntervalSeconds` (the last samples-bearing
frame's `intervalSeconds`, `null` until one has been seen), and
`liveSnapshotToCurrent` stamps that value onto the rolling window instead of
inventing WindNerd's 3 seconds — with no interval ever seen the samples block
stays absent. Minor rather than patch for the new snapshot field.
