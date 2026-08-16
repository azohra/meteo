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
    ],
    edges: [],
    views: ["scene", "svg", "meteogram", "compare-board"],
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
