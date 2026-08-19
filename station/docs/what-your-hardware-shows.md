---
title: What your hardware shows
description: "The capability flags each adapter declares, and exactly which surfaces appear, degrade, or stay hidden for your station."
---

Every station on the wire declares its
[capabilities](/docs/station/wire-contract/) — and the display surfaces
believe the declaration. Nothing is inferred, nothing is zero-filled: a
station without a capability renders **less page**, not placeholder data.
This page is the map from your hardware to your screen.

## What each vendor declares

| Vendor | `gustLull` | `temperature` | `conditions` | `history` | `live` | `battery` | `recentSummaries` |
|---|---|---|---|---|---|---|---|
| [WindNerd](/docs/station/adapters/windnerd/) | yes | if configured | pressure, if configured | **yes** | **yes** | if configured | **yes** |
| [Tempest](/docs/station/adapters/tempest/) | yes | yes | yes | **no** | no | no | no |
| [Campbell](/docs/station/adapters/campbell/) | yes | yes | no | **yes** | no | no | no |
| [Ecowitt](/docs/station/adapters/ecowitt/) | yes | yes | yes | **no** | no | if configured | no |

A [custom adapter](/docs/station/adapters/) declares its own row.

## What each capability turns on

| Capability | With it | Without it |
|---|---|---|
| `history` | `WindHistoryChart`, `TrendChart`, the sparkline, the daily pattern | The two charts return `hidden` outright — the card renders **no chart at all**, not an empty one; the sparkline needs at least two history points; the daily pattern has nothing to aggregate |
| `live` | The `/live` SSE stream, `useStationLive` / `createStationLiveStore`, and `WindSampleStrip` | `/live?station=` answers **404**; the live hooks never connect; the sample strip has no input |
| `conditions` | The air matrix's columns, pressure and conditions readouts | The station simply contributes no column; readouts stay absent |
| `temperature` | Temperature readouts and the temperature trend series | Absent |
| `gustLull` | Gust and lull flanks on strips and current readouts | Absent |
| `battery` | The wire document's telemetry block | No display surface reads it today; it travels for your own consumers |
| `recentSummaries` | The wire's pre-digested step blocks (WindNerd: ten 1-minute and twelve 5-minute steps), refreshed by the live stream's `summaries` frames, drawn by `RecentSummaries` / `<meteo-recent-summaries>` | The panels render nothing; not derivable client-side — the samples ring covers only ~10 minutes |

Two consequences worth planning around:

- **The card in the docs' figures shows a history chart.** If your station
  declares `history: false` (Tempest, Ecowitt), your `StationCard` renders
  the dial and readouts and no chart — that is correct behaviour, not a
  wiring error. Pair a history-less station with one that has it, or accept
  the shorter card.
- **Live is one vendor today.** Only WindNerd declares `live`. Streaming
  APIs are safe to leave wired for a mixed fleet — they apply per station —
  but a Tempest-only or Ecowitt-only page should not reach for
  `useStationLive`.
