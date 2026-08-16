---
"@azohra/meteo.briefing": minor
---

The transport exports `documentPaths`, the published tree's path
  layout in one place: `manifest(model)`, `siteDocument(model, site)`,
  `history(model, site, month)`, `historyIndex(model, site, month)`, and
  the dataset-root `models()`, `sites()`, `siteContext()`, and `runs()`,
  each returning the document's root-relative path. The transport and
  history loaders now build every URL as `${baseUrl}/${documentPaths...}`
  (byte-identical to the literals they replace), and consumers
  addressing the tree where there is no URL at all (object-store keying,
  e.g. a Cloudflare R2 bucket binding) key from the same functions. The
  observation document and the catalogue's observation entries gain an
  optional `quantity` (`"downwardShortwave" | "aot"`) naming the measured
  quantity; absence means the document predates the tag, never that a
  default applies. Schema artifacts regenerated to match.
