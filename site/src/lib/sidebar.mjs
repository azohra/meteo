export const sidebar = [
  {
    label: "Start here",
    items: [
      { slug: "docs", label: "Project overview" },
      { slug: "docs/glossary", label: "Glossary" },
      { slug: "docs/compatibility", label: "Compatibility" },
    ],
  },
  {
    label: "Briefing",
    items: [
      { slug: "docs/briefing", label: "The read side" },
      { slug: "docs/briefing/render-first-meteogram", label: "Render a first Meteogram" },
      { slug: "docs/briefing/reading-a-meteogram", label: "Reading a Meteogram" },
      { slug: "docs/briefing/contract", label: "Contract" },
      { slug: "docs/briefing/transport", label: "Transport" },
      { slug: "docs/briefing/derive", label: "Pure derivations" },
      { slug: "docs/briefing/analyze", label: "Analyze a profile" },
      { slug: "docs/briefing/compare", label: "Compare profiles" },
      { slug: "docs/briefing/history", label: "History and convergence" },
      {
        label: "Documents",
        items: [
          { slug: "docs/briefing/profile-document", label: "Profile" },
          { slug: "docs/briefing/smoke-document", label: "Smoke document" },
          { slug: "docs/briefing/observation-document", label: "Observation document" },
          { slug: "docs/briefing/site-context-document", label: "Site context" },
          { slug: "docs/briefing/manifest", label: "Manifest" },
          { slug: "docs/briefing/catalogue", label: "Model catalogue" },
          { slug: "docs/briefing/ensemble-values", label: "Ensemble values" },
          { slug: "docs/briefing/history-archives", label: "History archives" },
        ],
      },
      {
        label: "Meteogram internals",
        items: [
          { slug: "docs/briefing/scene", label: "Scene graph" },
          { slug: "docs/briefing/svg", label: "SVG renderer and key" },
        ],
      },
      {
        label: "Recipes",
        items: [
          { slug: "docs/briefing/run-an-ingest", label: "Run an ingest" },
          { slug: "docs/briefing/wire-an-inspector", label: "Wire an inspector" },
        ],
      },
      { slug: "docs/briefing/versioning", label: "Package versioning" },
    ],
  },
  {
    label: "Forecast",
    items: [
      { slug: "docs/forecast", label: "Engine and CLI" },
      {
        label: "Publish forecasts",
        items: [
          { slug: "docs/forecast/configure-launches", label: "Configure launches" },
          { slug: "docs/forecast/choosing-models", label: "Choose models" },
          { slug: "docs/forecast/run-one-model", label: "Run one model" },
          { slug: "docs/forecast/environment", label: "Environment and credentials" },
          { slug: "docs/forecast/schedule-builds", label: "Schedule builds" },
          { slug: "docs/forecast/tune-the-wire", label: "Tune the wire" },
          { slug: "docs/forecast/static-output", label: "Publish static output" },
          { slug: "docs/forecast/downstream-access", label: "Downstream access" },
        ],
      },
      { slug: "docs/forecast/architecture", label: "Forecast architecture" },
      { slug: "docs/forecast/derivation-science", label: "Meteogram derivations" },
      { slug: "docs/forecast/the-mountain-the-model-sees", label: "The mountain the model sees" },
      { slug: "docs/forecast/model-capabilities", label: "Model capabilities" },
      { slug: "docs/forecast/forecast-model-feeds", label: "Forecast model feeds" },
      { slug: "docs/forecast/provider-transports", label: "Provider transports" },
      { slug: "docs/forecast/builder-contract", label: "Builder contract" },
    ],
  },
  {
    label: "Station",
    items: [
      { slug: "docs/station", label: "Live station display" },
      { slug: "docs/station/getting-started", label: "Getting started" },
      {
        label: "Adapters",
        items: [
          { slug: "docs/station/adapters", label: "How adapters work" },
          { slug: "docs/station/adapters/windnerd", label: "WindNerd" },
          { slug: "docs/station/adapters/tempest", label: "Tempest" },
          { slug: "docs/station/adapters/campbell", label: "Campbell" },
          { slug: "docs/station/adapters/ecowitt", label: "Ecowitt" },
        ],
      },
      { slug: "docs/station/what-your-hardware-shows", label: "What your hardware shows" },
      { slug: "docs/station/component-gallery", label: "Component gallery" },
      { slug: "docs/station/react", label: "React" },
      { slug: "docs/station/elements", label: "Custom elements" },
      { slug: "docs/station/theming", label: "Theming" },
      { slug: "docs/station/client-data", label: "Client data" },
      { slug: "docs/station/wire-contract", label: "Wire contract" },
    ],
  },
  {
    label: "GRIB",
    items: [
      { slug: "docs/grib", label: "GRIB2 in pure TypeScript" },
      { slug: "docs/grib/coverage", label: "What it decodes" },
      { slug: "docs/grib/correctness", label: "The ecCodes gate" },
      { slug: "docs/grib/jpeg2000", label: "JPEG 2000 and the pool" },
    ],
  },
  {
    label: "JPEG 2000",
    items: [
      { slug: "docs/j2k", label: "A T.800 decoder in TypeScript" },
      { slug: "docs/j2k/subset", label: "The subset" },
      { slug: "docs/j2k/correctness", label: "Correctness" },
      { slug: "docs/j2k/performance", label: "Performance" },
    ],
  },
  {
    label: "Core",
    items: [
      { slug: "docs/core", label: "The shared foundation" },
      { slug: "docs/core/conventions", label: "Units, angles, one wind sign" },
      { slug: "docs/core/failures-and-schema", label: "Failures and schema artifacts" },
    ],
  },
];
