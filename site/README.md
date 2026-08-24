# meteo.azohra.com

Astro renders the logbook entries in `src/content/logbook/`, and the learning, model,
publishing, and reference guides — including the living forecast model feed reference — in
`src/content/docs/`.
Teaching figures use deterministic synthetic profiles bundled at build time. Normal site routes do
not fetch the launch catalogue, current manifests, or current profiles in the browser.

## Developing

```sh
pnpm install
pnpm dev      # http://localhost:4321
pnpm check    # typecheck
mise run build && (cd site && pnpm exec astro build)   # -> site/dist/
```

## Source map

- `src/lib/catalogue.ts` — parses the packaged `forecast/models.json` through the
  package contract at build time, so catalogue drift fails the build
  before capability and horizon figures are generated.
- `src/lib/scenarios.ts` — eagerly validates generated scenario profiles and
  exposes them to the site as immutable build inputs.
- `src/components/labs/` — interactive teaching figures driven by those
  synthetic profiles and the `@azohra/meteo.briefing` package's derivation and rendering
  authorities.
- `src/components/docs/`, `logbook/`, `about/`, `home/` — figure and page
  compositions, housed by the page family that consumes them; the shared
  figure frame lives in `src/components/figure/`.
- `src/content/docs/docs/` — the Starlight documentation portal, including the learning, model,
  and publishing routes. Capability-owned pages — including the document references and the
  living forecast model feed reference (`forecast/docs/forecast-model-feeds.mdx`) — enter the
  collection through committed symlinks: `docs/briefing`, `docs/station`, and `docs/forecast`
  point at each package's `docs/` directory, so their authority stays with the package.
- `src/content/logbook/*.mdx` — the canonical logbook entries, with validated metadata and
  explicit figure placement. `src/lib/logbook.ts` derives archive, navigation, and related-entry
  metadata from the content collection.

## Deploying

`astro build` (run via `mise run site:build`) writes the static site to `dist/`; [`wrangler.jsonc`](wrangler.jsonc)
describes serving it as Worker static assets. Where and how a deployment
hosts it is the operator's business, not this README's.
