---
title: Theming
description: "Token-driven theming for the station components: .meteo-root scoping, the class and token vocabulary, dark mode and the toggle, and speed bands."
---

Every colour the components paint rides a CSS custom property with a light
fallback baked in. Import the default skin once:

<!-- meteo-doc-fence: ignore — a CSS side-effect import; there are no type declarations to check -->
```ts
import "@azohra/meteo.station/styles.css";
```

Then wrap your markup in `.meteo-root` for the token set. Override any token
on any ancestor to retheme.

## Scoping and layering

- **`.meteo-root`** carries the tokens and `color-scheme`. Components outside
  a `.meteo-root` still render (the light fallbacks apply); inside one, every
  token is themeable.
- The whole sheet ships inside **`@layer meteo`**, so your unlayered CSS
  always outranks it: no specificity fights, no `!important`.

## Light, dark, and the toggle

Tokens are defined once via `light-dark()` with `color-scheme: light dark` on
the root, so the system preference picks the theme with no duplicate token
blocks. A manual toggle sets `data-theme="dark"` (or `"light"`) on
`.meteo-root`, a one-line `color-scheme` pin that beats the system
preference:

```html
<div class="meteo-root" data-theme="dark">…</div>
```

Remove the attribute (or set any other value) to return to following the
system. Because both arms of every token are always declared, a theme switch
is instant and complete: there is no partially-themed state.

## The vocabulary

Everything the platform ships (classes and tokens) starts with `meteo-`, so
one grep of your page finds all of it. Within that root, three tiers:

- **Bare `meteo-*`**: the shared skin and generic furniture any capability
  may use: surfaces, ink, `meteo-grid-line`, `meteo-tick`, `meteo-cursor`,
  `meteo-hit`, `meteo-microlabel`, the freshness badge, the value/unit
  spans.
- **`meteo-band-*`**: speed grading, deliberately platform-wide: today the
  station components wear `meteo-band-0..n`; any future capability that
  grades wind speeds wears the same tokens.
- **`meteo-<family>-*`**: component-family scope. Wind lives only where
  wind is actually visualized: `meteo-wind-*` (dial, rose, the wind history
  chart, vanes, the lull–gust band). Station-level artifacts are
  station-scoped (`meteo-station-card-*`, `meteo-station-table-*`,
  `meteo-current-*`, `meteo-summary-*`) because a station is a weather
  station, not a wind station. Alongside: `meteo-air-*`, `meteo-sample-*`,
  `meteo-trend-*`, `meteo-strip-*`, `meteo-sparkline-*`. The Meteogram renderer already
  follows the same pattern (`meteo-gram-*`, themed on the
  [SVG renderer page](/docs/briefing/svg/)), and
  future capabilities continue it (`meteo-sounding-*`).

## Hook-only classes

Some of the vocabulary is deliberately unstyled: the default skin paints
nothing on these classes; they exist as consumer styling seams, stable
handles on parts the skin leaves alone. They are versioned API like every
other class, and a test holds the list against both the source and the
stylesheet.

<!-- Kept in sync by hand with station/test/hook-only-classes.ts (the
     committed allowlist station/test/class-contract.test.ts enforces);
     the test cannot read this prose, so edit both together. -->

| Class | Seam |
|---|---|
| `meteo-speed` / `meteo-temperature` / `meteo-pressure` | The reading's kind, on each text atom's `<data>` element |
| `meteo-grid-label` | Axis labels in the SVG charts |
| `meteo-tick` | Axis tick marks in the SVG charts |
| `meteo-wind-gap` | The dropout gap group in the wind charts |
| `meteo-wind-vane-calm` | A calm hour's vane glyph |
| `meteo-wind-dial` | The dial's SVG root |
| `meteo-wind-dial-bezel` | The dial's bezel ring |
| `meteo-wind-needle` | The dial's direction needle |
| `meteo-current-observed` / `meteo-current-chill` | The current-conditions reading rows |
| `meteo-current-flank-gust` / `meteo-current-flank-lull` | The gust and lull flanks around the dial |
| `meteo-station-card-identity` / `-elevation` / `-source` | The station card's header regions |
| `meteo-station-table-time` / `meteo-strip-time` | Time cells in the table and the strip |
| `meteo-air-corner` | The air matrix's corner cell |

Unstyled by design: style them from your own CSS, or leave them be; the
default look does not depend on them. The SVG text seams
(`meteo-grid-label`, `meteo-tick`) are not bare, though: font, size, and
ink arrive from their chart's base `.meteo-*-svg text` rule, so the class
itself carries no rule to replace: override the base dress, don't rebuild
it.

## Token reference

![Every station theme token with its light and dark values as labelled colour swatches, grouped into chrome and identity, freshness states, chart and wind encoding, and the five-step band ramp; the font, radius, and shadow tokens listed as text.](figures/token-map.svg)

### `--meteo-*` — the shared skin

| Token | Role |
|---|---|
| `--meteo-surface` | Card and panel background |
| `--meteo-surface-raised` | Raised elements (dial face, matrix header) |
| `--meteo-ink` | Primary text and strokes |
| `--meteo-muted` | Secondary text, axis labels |
| `--meteo-border` | Card and table borders |
| `--meteo-grid` | Chart gridlines |
| `--meteo-accent` | The accent (ungraded traces, links, emphasis) |
| `--meteo-gap` | Dropout hatching in charts |
| `--meteo-cursor` | The chart inspector cursor |
| `--meteo-freshness-live` / `-aging` / `-stale` | The freshness badge states |
| `--meteo-font` | Font stack for all component text (incl. SVG) |
| `--meteo-radius` | Corner radius |
| `--meteo-shadow` | Card shadow |

### `--meteo-band-*` — speed grading, platform-wide

| Token | Role |
|---|---|
| `--meteo-band-0` … `--meteo-band-4` | Speed grading, calm → strong |

### `--meteo-wind-*` — genuinely wind-scoped

| Token | Role |
|---|---|
| `--meteo-wind-band-fill` | The lull–gust envelope fill |
| `--meteo-wind-mean` | The mean trace when ungraded |
| `--meteo-wind-vane` | Vane glyphs in the direction row |
| `--meteo-wind-compare` | The day-over-day compare overlay trace |
| `--meteo-wind-favorable` / `--meteo-wind-unfavorable` | The rose's judgment ring |

## Speed bands and your palette

`thresholds` ([React](/docs/station/react/#thresholds)) grades traces, dial
arcs, and rose petals into `meteo-band-0..n` **classes**; what a band means
and what colour it wears belong to your CSS. Three thresholds make four
bands; add `--meteo-band-*` overrides (and rules for higher indices if you
declare more thresholds) to speak your own colour language.

## Dark-mode notes

- The site's theme toggle over the
  [component gallery](/docs/station/component-gallery/) exercises exactly
  this mechanism: `data-theme` on `.meteo-root`, nothing else.
- If your page also styles `color-scheme` globally, the root's own
  declaration wins inside `.meteo-root`; the components stay coherent even
  when the page around them disagrees.
- README imagery is generated from these same tokens, so the docs never
  drift from the palette.
