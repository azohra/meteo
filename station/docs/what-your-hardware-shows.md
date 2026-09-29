---
title: What your hardware shows
description: "The capability flags each adapter declares, and which display surfaces appear, degrade, or stay hidden for your station."
---

Every station on the wire declares its
[capabilities](/docs/station/wire-contract/), and the display surfaces
render from that declaration alone. A station without a capability gets a
shorter page with no placeholder data in it. This page maps your hardware
to what appears on screen.

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
| `history` | `WindHistoryChart`, `TrendChart`, the sparkline, the daily pattern | The two charts return `hidden`, so the card renders no chart at all rather than an empty one. The sparkline needs at least two history points. The daily pattern has nothing to aggregate |
| `live` | The `/live` SSE stream, `useStationLive` / `createStationLiveStore`, and `WindSampleStrip` | `/live?station=` answers **404**. The live hooks never connect. The sample strip has no input |
| `conditions` | The air matrix's columns, pressure and conditions readouts | The station contributes no column, and the readouts stay absent |
| `temperature` | Temperature readouts and the temperature trend series | Absent |
| `gustLull` | Gust and lull flanks on strips and current readouts | Absent |
| `battery` | The wire document's telemetry block | No display surface reads it today. It travels for your own consumers |
| `recentSummaries` | The wire's pre-digested step blocks (WindNerd: ten 1-minute and twelve 5-minute steps), refreshed by the live stream's `summaries` frames and drawn by `RecentSummaries` / `<meteo-recent-summaries>` | The panels render nothing. The blocks can't be derived client-side, because the samples ring covers only ~10 minutes |

Two of these affect how you plan a page.

The card in the docs' figures shows a history chart. If your station
declares `history: false` (Tempest, Ecowitt), your `StationCard` renders
the dial and readouts with no chart, as declared. Pair a history-less
station with one that has history, or accept the shorter card.

Only WindNerd declares `live` today. The streaming APIs apply per station,
so it is safe to leave them wired for a mixed fleet. A Tempest-only or
Ecowitt-only page should not reach for `useStationLive`.
