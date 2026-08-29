# meteo by Azohra brand guide

meteo by Azohra is an open-source meteorology platform for free flight. It helps
pilots, clubs, developers, and independent publishers inspect, publish, and
build on forecast and live station data.

## Name

- Write **meteo** in lowercase in product prose and branded lockups.
- Use **meteo by Azohra** when the product must stand alone, including its first
  mention, page metadata, and accessibility labels.
- Keep the `@azohra/meteo.*` package namespace unchanged.
- The name has no full stop. A point may appear as a graphic device, but it is
  not spoken, indexed, or included in a URL.
- Keep the masthead descriptor confined to the brand lockup and root README.
- Name capabilities with text, such as **meteo · Station**. Do not give them
  separate logos or brand colours.

## Audience and responsibility

This repository speaks to people who publish or build weather tools. The project
site documents the platform; it is not a live forecast page for pilots.

A downstream publisher owns access, alerts, local knowledge, safety language,
and the surrounding visual identity. meteo supplies inspectable data contracts,
derivations, and presentation libraries. It does not decide whether a day is
safe to fly.

Assume technical curiosity, not prior knowledge of the repository. Explain a
term on first use or link to its definition. Credit the providers, research,
projects, and people on which a method depends.

## Meteorological language

Keep these distinctions visible:

- observation and forecast;
- provider value and meteo derivation;
- deterministic value and ensemble distribution;
- implemented method and calibrated result; and
- chart reading and judgment about whether to fly.

A model shows, projects, or forecasts a value. Put uncertainty, freshness,
missing capability, units, and material limitations beside the claim they
qualify. Preserve absence instead of inventing a zero or estimate.

## Visual system

The project site takes its cues from instrument panels in cold morning air:
pale surfaces, dark pre-dawn backgrounds, glacier teal, fine rules, compact
labels, and legible data.

Glacier teal carries interaction and identity. Scientific data, status, and wind
grades use their own semantic colours and labels. The short wind-grade rule may
appear once as a brand reference; it must not look like a forecast value.

Use Instrument Sans for site display and prose. Use the system monospace for
commands, wire data, measurements, and compact labels. Keep headings in sentence
case. Motion must explain live state, flow, sequence, or a response to input.

## Surface boundaries

| Surface | Authority |
| --- | --- |
| Project site and documentation | `site/src/styles/theme.css` and site components |
| Station components | `station/styles.css` and the public `--meteo-*` tokens |
| Meteogram scenes and SVG | `briefing/src/scene/`, `briefing/src/svg/theme.ts`, presentation options, and golden fixtures |
| Teaching and research figures | Their source and the documentation figure generator |

The Meteogram palette follows its meteorological and Canada RASP lineage. It
does not inherit ambient site colours. Station components expose a themeable
public contract for downstream sites.

## Accessibility

- Meet WCAG AA contrast on supported surfaces.
- Keep keyboard focus visible and preserve meaning without colour.
- Pair chart and status colour with text, position, shape, or texture.
- Support keyboard, touch, high zoom, narrow screens, and reduced motion.
- Keep freshness, uncertainty, and missing data available without hover or
  animation.
- Give meaningful figures an equivalent explanation and hide decorative marks
  from assistive technology.

The [About page](https://meteo.azohra.com/about/) owns the project's story.
Package manifests and `capabilities.ts` own package names and boundaries. Dated
package references own provider facts. Do not copy exact theme values into
prose; the source files above are the authority.
