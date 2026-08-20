/* Declares the display capabilities — briefing and station — whose export
   surfaces, layer boundaries, and view stacks the boundaries suite
   enforces in full. The scope is deliberate: core is the foundation every
   package may import; the forecast engine is modelled as briefing's
   external server (public-subpath imports only); and the decoder pair is
   one import edge (grib -> j2k) held to manifest parity. Extend this
   declaration only when a package grows a layered view surface of its
   own. */
export interface PackageHome {
  package: string;
  directory: string;
}

export interface CapabilityDeclaration extends PackageHome {
  name: string;
  subpaths: string[];
  edges: string[];
  views: string[];
  external?: Record<string, string>;
}

export const FOUNDATION: PackageHome = {
  package: "@azohra/meteo.core",
  directory: "core",
};

export const CAPABILITIES: CapabilityDeclaration[] = [
  {
    name: "briefing",
    package: "@azohra/meteo.briefing",
    directory: "briefing",
    subpaths: [
      ".",
      "contract",
      "derive",
      "analyze",
      "compare",
      "transport",
      "history",
      "meteogram",
      "compare-board",
      "sounding",
    ],
    edges: [],
    views: ["scene", "svg", "meteogram", "sounding", "compare-board"],
    external: { server: "@azohra/meteo.forecast" },
  },
  {
    name: "station",
    package: "@azohra/meteo.station",
    directory: "station",
    subpaths: [
      ".",
      "client",
      "fixtures",
      "server",
      "react",
      "elements",
      "elements/register",
      "styles.css",
    ],
    edges: [],
    views: ["scene", "react", "elements"],
  },
];

export function platformPackages(): PackageHome[] {
  return [FOUNDATION, ...CAPABILITIES];
}

export function expectedExportSubpaths(
  capability: CapabilityDeclaration,
  hasSchemaArtifacts: boolean,
): string[] {
  const entries = ["./package.json"];
  for (const subpath of capability.subpaths) {
    entries.push(subpath === "." ? "." : `./${subpath}`);
  }
  if (hasSchemaArtifacts) entries.push("./schema/*.json");
  return entries.sort();
}

export function expectedFoundationExportSubpaths(): string[] {
  return [".", "./package.json"];
}
