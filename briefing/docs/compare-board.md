---
title: Compare board
description: "One local day across a comparison's members, as marks on one shared clock: a renderer-agnostic scene of windows, exceedances, cap timing, and per-model cells, with a minimal SVG serializer."
---

`@azohra/meteo.briefing/compare-board` turns a [comparison](/docs/briefing/compare/)'s
findings into one drawable statement: every model's day on one shared
07:00–21:00 clock, so window timing, over-ceiling hours, cap breaks, and
rain onset compare by **position down a column** instead of by reading
ten prose rows. The scene is the product — typed geometry and numbers a
DOM, canvas, or terminal renderer can draw without re-deriving anything;
the package's own SVG serializer is the minimal reference rendering.

The subpath consumes only what [analyze](/docs/briefing/analyze/) and
[compare](/docs/briefing/compare/) already state. Every threshold on the
board arrived inside the analyses the caller built — wind ceilings and
floors are the caller's judgment parameters, and the board adds none of
its own.

## Build a board

```ts title="board.ts"
import { analyzeForecast, type ForecastAnalysis } from "@azohra/meteo.briefing/analyze";
import { compareAnalyses } from "@azohra/meteo.briefing/compare";
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import {
  buildCompareBoardScene,
  renderCompareBoardSvg,
  type CompareBoardScene,
} from "@azohra/meteo.briefing/compare-board";

export function boardFor(profiles: readonly SiteForecast[], dateKey: string): string {
  const analyses: ForecastAnalysis[] = profiles.map((profile) =>
    analyzeForecast(profile, {
      timeZone: "America/Vancouver",
      launch: { elevationM: 1225.1 },
      // Your ceilings, not the package's: without them the lane simply
      // carries no exceedance spans (AnalyzeOptions.windCeilings has no
      // defaults).
      windCeilings: { surfaceMps: 5.4, bandMps: 6.7 },
    }),
  );
  const scene: CompareBoardScene = buildCompareBoardScene(analyses, compareAnalyses(analyses), {
    dateKey,
    timeZone: "America/Vancouver",
  });
  return renderCompareBoardSvg(scene, { idPrefix: "site-board" });
}
```

The comparison orders the rows and names benched members; pass `null` to
board bare analyses in input order. Coherence is validated, never
reconstructed, with the same named errors as
[`compareAnalyses`](/docs/briefing/compare/#compare-cached-analyses):
one site, one timezone (the board's own, since day keys pair only in one
zone), one analysis vocabulary, distinct members.

## The shared clock

`compareBoardDayAxis` resolves the local day span (default 07:00–21:00,
ticks at 8/12/16/20 — the same pilots' day the
[Meteogram displays](/docs/briefing/scene/)) to UTC instants through
`Intl`, never offset arithmetic, so DST days keep their true length.
`xForBoardTime(axis, atMs)` is the one time→x mapping: a fraction 0..1
of the day span, clamped at the edges. Every geometric element in the
scene carries both its fractions and its cited instants.

Bars and words diverge deliberately: a span's `endMs`/`x1` widen the
last **cited** hour by the finding's own step, so a bar covers the hour
it cites; `endCitedMs`/
`x1Cited` stop at the finding's own last hour, the honest end for any
words. Describe a window with `end.local`, draw it to `x1` — a caption
built from `endMs` contradicts every other statement of the same
finding.

## What a row states

Each `CompareBoardRow` is one member's day, from that member's own
findings. `null` means the member's data states nothing for the cell —
print a dash, never silence dressed as calm.

| Row field | Source finding | Notes |
| --- | --- | --- |
| `windows` | `thermalWindow` | Clip flags mark document-horizon edges; a midnight-spanning window carries `viaWindowFrom` |
| `exceedances`, `overCeiling` | `windExceedance` | The caller's ceiling echoed per span; gust spans carry the declared class; absence is **no statement**, never verified calm |
| `rainStart` | `capTiming` / `convectiveDay` / `quietDay` | First hour over the analysis's own precipitation floor, with the stating finding named |
| `launch` | `windDirection` | Endpoint samples at the window's open, peak-lift hour, and close; deterministic members only |
| `gust` | `windSummary` | m/s with `semantics` carried — hour-max and instantaneous gusts are different objects; label them differently, never pool them |
| `aloft` | `windSummary.maxWindInBand` | Window-scoped when stated, whole-day otherwise (`scope` says which) |
| `top` | `thermalWindow` + `liftCeiling` | The day's peak lift top; `cloudCapped` states the cause at the cited peak hour — true means the number IS cloud base |
| `storms` | `capTiming` / `convectiveDay` | Structured verdicts, not prose; `capUnjudgeable` means the model publishes no CIN, and CAPE never compares across rows |
| `vote` | `windowAgreement` vocabulary | Non-votes carry their reason: `abstained` (`truncatedDay` / `outOfHorizon`) or `benched` (terrain), the comparison's own categories |

Ensemble rows carry `kind: "ensemble"` and blank what the document
cannot support: no `capTiming`/`convectiveDay` story, no circular
direction statistics, and band or gust cells only where the document
publishes those series. Wind values stay SI (m/s) on the whole surface;
unit conversion belongs to the consumer.

## The reference SVG

`renderCompareBoardSvg(scene, { idPrefix })` serializes a self-contained
document. Colour is never the only encoding: windows, exceedance bars,
cap marks, and rain drops occupy distinct lane positions with distinct
shapes, clipped edges wear open chevrons, and every row and cell carries
its text equivalent as a `<title>`. Give each board on a page its own
`idPrefix`.

Styling rides `--meteo-board-*` custom properties with light fallbacks
baked in — the same token convention as the Meteogram's
[`--meteo-gram-*` set](/docs/briefing/svg/) and the
[station families](/docs/station/theming/). `BOARD_TOKEN_DEFAULTS` is
the one home for the default values; `DEFAULT_BOARD_STYLESHEET` is the
embedded sheet, replaceable per render.

```ts title="retheme.ts"
import {
  BOARD_TOKEN_DEFAULTS,
  DEFAULT_BOARD_STYLESHEET,
} from "@azohra/meteo.briefing/compare-board";

// One rule on any ancestor moves a colour everywhere it appears:
export const darkWindow = `.my-page { --meteo-board-window: #7fb5d6; }`;
// The defaults remain inspectable data, not copies:
export const windowDefault: string = BOARD_TOKEN_DEFAULTS.window;
export const sheet: string = DEFAULT_BOARD_STYLESHEET;
```

## Versioning

The board reads the analyze vocabulary and validates
`vocabularyVersion` on every envelope, with re-analysis as the named
remedy — the same
[tolerant-reader convention](/docs/briefing/analyze/#versioning-reads-tolerantly)
that governs every reader of the finding kinds. The scene types version
with the package on the npm axis
([package versioning](/docs/briefing/versioning/)).
