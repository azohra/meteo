---
title: Compare board
description: "Draw one local day for every member of a comparison on one shared clock: a renderer-agnostic scene of windows, exceedances, cap timing, and per-model cells, with a minimal SVG serializer."
---

`@azohra/meteo.briefing/compare-board` draws a
[comparison](/docs/briefing/compare/)'s findings as one chart. Every
model's day sits on one shared 07:00–21:00 clock, so a reader compares
window timing, over-ceiling hours, cap breaks, and rain onset by position
down a column instead of reading ten rows of prose. The scene carries
typed geometry and numbers that a DOM, canvas, or terminal renderer can
draw without deriving anything again. The package's own SVG serializer is
the minimal reference rendering.

The board uses only what [analyze](/docs/briefing/analyze/) and
[compare](/docs/briefing/compare/) already state. Every threshold on it
came inside the analyses the caller built. Wind ceilings and floors are
the caller's judgment parameters, and the board adds none of its own.

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
      // Caller-supplied ceilings (AnalyzeOptions.windCeilings has no
      // defaults): without them the lane carries no exceedance spans.
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

The comparison orders the rows and names benched members. Pass `null`
instead to draw the analyses alone, in input order. The board checks that
the analyses belong together, with the same named errors as
[`compareAnalyses`](/docs/briefing/compare/#compare-cached-analyses). They
must share one site, one timezone (the board's own, because day keys pair
only within one zone), and one analysis vocabulary, and each member must
be distinct.

## The shared clock

`compareBoardDayAxis` converts the local day span to UTC instants. The
default span is 07:00–21:00 with ticks at 8, 12, 16, and 20, the same
pilots' day the [Meteogram displays](/docs/briefing/scene/). The
conversion goes through `Intl` rather than offset arithmetic, so DST days
keep their true length. `xForBoardTime(axis, atMs)` is the only time-to-x
mapping. It returns a fraction from 0 to 1 of the day span, clamped at the
edges. Every geometric element in the scene carries both its fractions
and its cited instants.

Bars and words end at different points. A span's `endMs` and `x1` extend
the last cited hour by the finding's own step, so a bar covers the hour it
cites. `endCitedMs` and `x1Cited` stop at the finding's last hour, which is
the right end for text. Describe a window with `end.local` and draw it to
`x1`. A caption built from `endMs` contradicts every other statement of
the same finding.

## What a row states

Each `CompareBoardRow` is one member's day, built from that member's own
findings. `null` means the member's data states nothing for that cell.
Print a dash there, because a blank could be read as calm.

| Row field | Source finding | Notes |
| --- | --- | --- |
| `windows` | `thermalWindow` | Clip flags mark document-horizon edges; a midnight-spanning window carries `viaWindowFrom` |
| `exceedances`, `overCeiling` | `windExceedance` | Each span echoes the caller's ceiling, and gust spans carry the declared class. An absent span states nothing; it does not verify calm |
| `rainStart` | `capTiming` / `convectiveDay` / `quietDay` | First hour over the analysis's own precipitation floor, with the stating finding named |
| `launch` | `windDirection` | Endpoint samples at the window's open, peak-lift hour, and close; deterministic members only |
| `gust` | `windSummary` | m/s with `semantics` carried. Hour-max and instantaneous gusts are different quantities: label them differently and do not pool them |
| `aloft` | `windSummary.maxWindInBand` | Window-scoped when stated, whole-day otherwise (`scope` says which) |
| `top` | `thermalWindow` + `liftCeiling` | The day's peak lift top. `cloudCapped` states the cause at the cited peak hour; when it is true, the number is the cloud base |
| `storms` | `capTiming` / `convectiveDay` | Structured verdicts with no prose strings. `capUnjudgeable` means the model publishes no CIN. CAPE is not compared across rows |
| `vote` | `windowAgreement` vocabulary | Non-votes carry their reason: `abstained` (`truncatedDay` / `outOfHorizon`) or `benched` (terrain), the comparison's own categories |

Ensemble rows carry `kind: "ensemble"` and leave blank what the document
cannot support. They have no `capTiming` or `convectiveDay` story and no
circular direction statistics, and they fill band or gust cells only where
the document publishes those series. Wind values stay in SI (m/s)
throughout the board. Unit conversion is the consumer's job.

## The reference SVG

`renderCompareBoardSvg(scene, { idPrefix })` serializes a self-contained
SVG document. Colour is always paired with another encoding. Windows,
exceedance bars, cap marks, and rain drops each have their own lane
position and shape, clipped edges show open chevrons, and every row and
cell carries its text equivalent as a `<title>`. Give each board on a page
its own `idPrefix`.

Styles come from `--meteo-board-*` custom properties with light fallbacks
built in. This is the same token convention as the Meteogram's
[`--meteo-gram-*` set](/docs/briefing/svg/) and the
[station families](/docs/station/theming/). `BOARD_TOKEN_DEFAULTS` holds
the default values. `DEFAULT_BOARD_STYLESHEET` is the embedded stylesheet,
and you can replace it on each render.

```ts title="retheme.ts"
import {
  BOARD_TOKEN_DEFAULTS,
  DEFAULT_BOARD_STYLESHEET,
} from "@azohra/meteo.briefing/compare-board";

// One rule on any ancestor moves a colour everywhere it appears:
export const darkWindow = `.my-page { --meteo-board-window: #7fb5d6; }`;
// The defaults remain inspectable data:
export const windowDefault: string = BOARD_TOKEN_DEFAULTS.window;
export const sheet: string = DEFAULT_BOARD_STYLESHEET;
```

## Versioning

The board reads the analyze vocabulary and checks `vocabularyVersion` on
every envelope. When the version does not match, the error names
re-analysis as the fix. This is the same
[tolerant-reader convention](/docs/briefing/analyze/#versioning-reads-tolerantly)
every reader of the finding kinds follows. The scene types are versioned
with the package on npm ([package versioning](/docs/briefing/versioning/)).
