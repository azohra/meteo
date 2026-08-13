export const sidebar = [
  {
    label: "Start here",
    items: [
      { slug: "docs", label: "Choose your path" },
      { slug: "docs/overview", label: "Project overview" },
      { slug: "docs/getting-started", label: "Getting started" },
    ],
  },
  {
    label: "Publish",
    items: [
      { slug: "docs/publish/configure-launches", label: "Configure launches" },
      { slug: "docs/models/choosing", label: "Choose models" },
      { slug: "docs/publish/run-one-model", label: "Run one model" },
      { slug: "docs/publish/schedule-builds", label: "Schedule builds" },
      { slug: "docs/publish/static-output", label: "Publish static output" },
      { slug: "docs/publish/downstream-access", label: "Downstream access" },
    ],
  },
  {
    label: "Briefing",
    items: [
      { slug: "docs/briefing", label: "The read side" },
      { slug: "docs/briefing/contract", label: "Contract" },
      { slug: "docs/briefing/transport", label: "Transport" },
      { slug: "docs/briefing/run-an-ingest", label: "Run an ingest" },
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
          { slug: "docs/briefing/versioning", label: "Versioning" },
        ],
      },
      {
        label: "Meteogram",
        items: [
          { slug: "docs/briefing/render-first-meteogram", label: "Render a first Meteogram" },
          { slug: "docs/briefing/scene", label: "Scene graph" },
          { slug: "docs/briefing/wire-an-inspector", label: "Wire an inspector" },
          { slug: "docs/briefing/svg", label: "SVG renderer and key" },
          { slug: "docs/briefing/defaults-and-tokens", label: "Defaults and tokens" },
        ],
      },
      { slug: "docs/briefing/reading-a-meteogram", label: "Reading a Meteogram" },
    ],
  },
  {
    label: "Forecast",
    items: [
      { slug: "docs/forecast", label: "Engine and CLI" },
      { slug: "docs/forecast/architecture", label: "Forecast architecture" },
      { slug: "docs/forecast/derivation-science", label: "Meteogram derivations" },
      { slug: "docs/forecast/builder-contract", label: "Builder contract" },
      { slug: "docs/forecast/adding-a-model", label: "Add a model" },
      { slug: "docs/forecast/provider-transports", label: "Provider transports" },
      { slug: "docs/forecast/model-capabilities", label: "Model capabilities" },
      { slug: "docs/forecast/forecast-model-feeds", label: "Forecast model feeds" },
    ],
  },
  {
    label: "Station",
    items: [
      { slug: "docs/station", label: "Live station display" },
      { slug: "docs/station/getting-started", label: "Getting started" },
      { slug: "docs/station/wire-contract", label: "Wire contract" },
      {
        label: "Adapters",
        items: [
          { slug: "docs/station/adapters", label: "How adapters work" },
          { slug: "docs/station/adapters/windnerd", label: "WindNerd" },
          { slug: "docs/station/adapters/tempest", label: "Tempest" },
          { slug: "docs/station/adapters/campbell", label: "Campbell" },
        ],
      },
      { slug: "docs/station/client-data", label: "Client data" },
      { slug: "docs/station/react", label: "React" },
      { slug: "docs/station/elements", label: "Elements" },
      { slug: "docs/station/theming", label: "Theming" },
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
      { slug: "docs/j2k/correctness", label: "Two-ring correctness" },
      { slug: "docs/j2k/performance", label: "Performance, honestly" },
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
