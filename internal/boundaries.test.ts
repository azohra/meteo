import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  FOUNDATION,
  expectedExportSubpaths,
  expectedFoundationExportSubpaths,
  platformPackages,
  type CapabilityDeclaration,
} from "../capabilities.js";

const ROOT = join(__dirname, "..");
const CAPABILITY_PACKAGES = new Map(CAPABILITIES.map((c) => [c.package, c]));

const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "schema", "test"]);

interface MemberManifest {
  name: string;
  private?: boolean;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: { type?: string; url?: string; directory?: string };
  publishConfig?: { access?: string; registry?: string };
  engines?: Record<string, string>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readManifest(directory: string): MemberManifest {
  return JSON.parse(readFileSync(join(ROOT, directory, "package.json"), "utf-8")) as MemberManifest;
}

function workspaceMemberDirectories(): string[] {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf-8");
  const members: string[] = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (line.startsWith("packages:")) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const entry = line.match(/^\s+-\s+(\S+)/);
      if (entry) members.push(entry[1]);
      else if (line.trim() !== "") inPackages = false;
    }
  }
  return members;
}

const WORKSPACE_MANIFESTS = new Map(
  workspaceMemberDirectories().map((directory) => [directory, readManifest(directory)]),
);

function memberByPackageName(name: string): { directory: string; manifest: MemberManifest } | null {
  for (const [directory, manifest] of WORKSPACE_MANIFESTS) {
    if (manifest.name === name) return { directory, manifest };
  }
  return null;
}

/* The suite walks the same directories and re-reads the same files from
   many tests; the tree does not change mid-run, so both walks memoize. */
const sourceFilesCache = new Map<string, string[]>();
const importSpecifiersCache = new Map<string, string[]>();

function sourceFiles(dir: string): string[] {
  let files = sourceFilesCache.get(dir);
  if (files === undefined) {
    files = [];
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry)) continue;
        files.push(...sourceFiles(rel));
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        files.push(rel);
      }
    }
    sourceFilesCache.set(dir, files);
  }
  return files;
}

function importSpecifiers(relPath: string): string[] {
  let specifiers = importSpecifiersCache.get(relPath);
  if (specifiers === undefined) {
    const source = readFileSync(join(ROOT, relPath), "utf-8");
    specifiers = [...source.matchAll(/(?:import|export)[^"']*from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    importSpecifiersCache.set(relPath, specifiers);
  }
  return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string {
  return posix.normalize(posix.join(dirname(fromFile).split("\\").join("/"), specifier));
}

function capabilityHasSchemaArtifacts(capability: CapabilityDeclaration): boolean {
  return existsSync(join(ROOT, capability.directory, "src", "internal", "schema-artifacts.ts"));
}

function publicSpecifiers(packageName: string): {
  exact: Set<string>;
  prefixes: string[];
} {
  const member = memberByPackageName(packageName);
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const key of Object.keys(member?.manifest.exports ?? {})) {
    if (key.includes("*")) {
      prefixes.push(`${packageName}/${key.slice(2, key.indexOf("*"))}`);
    } else {
      exact.add(key === "." ? packageName : `${packageName}/${key.slice(2)}`);
    }
  }
  return { exact, prefixes };
}

const publicSpecifiersCache = new Map<string, ReturnType<typeof publicSpecifiers>>();

function isPublicImport(specifier: string, packageName: string): boolean {
  let specifiers = publicSpecifiersCache.get(packageName);
  if (specifiers === undefined) {
    specifiers = publicSpecifiers(packageName);
    publicSpecifiersCache.set(packageName, specifiers);
  }
  const { exact, prefixes } = specifiers;
  return exact.has(specifier) || prefixes.some((prefix) => specifier.startsWith(prefix));
}

function scopedPackageName(specifier: string): string | null {
  const match = specifier.match(/^(@azohra\/[^/]+)(\/|$)/);
  return match ? match[1] : null;
}

describe("package surfaces (derived from the manifest)", () => {
  it("the foundation exports exactly its one curated surface", () => {
    const manifest = readManifest(FOUNDATION.directory);
    expect(manifest.name).toBe(FOUNDATION.package);
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(expectedFoundationExportSubpaths());
  });

  for (const capability of CAPABILITIES) {
    it(`${capability.package} exports exactly the subpaths the manifest declares — an exports entry appearing by accident is a compatibility promise nobody decided to make`, () => {
      const manifest = readManifest(capability.directory);
      expect(manifest.name).toBe(capability.package);
      expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(
        expectedExportSubpaths(capability, capabilityHasSchemaArtifacts(capability)),
      );
    });

    it(`${capability.package} depends on the foundation (and it is the workspace's)`, () => {
      const manifest = readManifest(capability.directory);
      expect(manifest.dependencies?.[FOUNDATION.package]).toBe("workspace:*");
    });
  }

  it("every declared platform package exists in the workspace under its declared directory", () => {
    for (const home of platformPackages()) {
      const member = memberByPackageName(home.package);
      expect(member?.directory, `${home.package} missing from the workspace`).toBe(home.directory);
    }
  });
});

describe("manifest parity (the publishable six and the shell)", () => {
  const shell = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as MemberManifest;
  const publishable = [...WORKSPACE_MANIFESTS].filter(([, m]) => m.private !== true);

  it("exactly six packages publish from the workspace", () => {
    expect(publishable.map(([directory]) => directory).sort()).toEqual([
      "briefing",
      "core",
      "forecast",
      "grib",
      "j2k",
      "station",
    ]);
  });

  it("the shell pins a Node engine floor", () => {
    expect(shell.engines?.node).toBeTruthy();
  });

  it("the changeset config declares public access — without it a scoped publish to npmjs defaults to restricted", () => {
    const changesets = JSON.parse(
      readFileSync(join(ROOT, ".changeset", "config.json"), "utf-8"),
    ) as { access?: string };
    expect(changesets.access).toBe("public");
  });

  for (const [directory, manifest] of publishable) {
    describe(`${manifest.name} (${directory}/)`, () => {
      it("declares the same engines as the shell — one Node floor for the platform", () => {
        expect(manifest.engines).toEqual(shell.engines);
      });

      it("carries the publishable identity fields: license MIT, author, homepage", () => {
        expect(manifest.license).toBe("MIT");
        expect(manifest.author).toBeTruthy();
        expect(manifest.homepage).toBeTruthy();
      });

      it("points repository at the platform repo and its own directory", () => {
        expect(manifest.repository?.url).toBe(shell.repository?.url);
        expect(manifest.repository?.directory).toBe(directory);
      });

      it("carries no publishConfig — the packages publish to npmjs, and public access is declared once for all of them in .changeset/config.json", () => {
        expect(manifest.publishConfig).toBeUndefined();
      });

      it("keeps every JS exports entry object-form with types and default conditions — an entry without types hands TypeScript consumers `any` (non-JS assets pass through as strings)", () => {
        for (const [key, value] of Object.entries(manifest.exports ?? {})) {
          if (typeof value === "string") {
            expect(
              /\.(json|css)$/.test(value),
              `${manifest.name} exports ${key} as a bare string (${value})`,
            ).toBe(true);
            continue;
          }
          expect(value, `${manifest.name} exports ${key}`).toBeTypeOf("object");
          const conditions = Object.keys(value as Record<string, unknown>);
          expect(conditions, `${manifest.name} exports ${key} without types`).toContain("types");
          expect(conditions, `${manifest.name} exports ${key} without default`).toContain(
            "default",
          );
        }
      });
    });
  }
});

describe("dependency direction (derived from the manifest)", () => {
  for (const capability of CAPABILITIES) {
    const allowedPackages = new Set(
      capability.edges
        .map((edge) => CAPABILITIES.find((entry) => entry.name === edge)?.package)
        .filter((name): name is string => name !== undefined),
    );

    it(`${capability.name} imports the foundation only as ${FOUNDATION.package}, siblings only along declared edges (${
      capability.edges.join(", ") || "none"
    }) and only through their public subpaths, and never reaches relatively outside its own directory`, () => {
      for (const file of sourceFiles(capability.directory)) {
        for (const specifier of importSpecifiers(file)) {
          const scoped = scopedPackageName(specifier);
          if (scoped === FOUNDATION.package) {
            expect(specifier, `${file} imports ${specifier}`).toBe(FOUNDATION.package);
            continue;
          }
          if (scoped !== null && CAPABILITY_PACKAGES.has(scoped)) {
            expect(allowedPackages.has(scoped), `${file} imports ${specifier}`).toBe(true);
            expect(isPublicImport(specifier, scoped), `${file} imports ${specifier}`).toBe(true);
            continue;
          }
          if (!specifier.startsWith(".")) continue;
          const [target] = resolveRelative(file, specifier).split("/");
          expect(target, `${file} imports ${specifier} (escapes the package)`).toBe(
            capability.directory,
          );
        }
      }
    });
  }

  it("the foundation imports no capability (an import from any @azohra package here is a dependency cycle) and never reaches relatively outside its own directory", () => {
    for (const file of sourceFiles(FOUNDATION.directory)) {
      for (const specifier of importSpecifiers(file)) {
        expect(scopedPackageName(specifier), `${file} imports ${specifier}`).toBeNull();
        if (!specifier.startsWith(".")) continue;
        const [target] = resolveRelative(file, specifier).split("/");
        expect(target, `${file} imports ${specifier} (escapes the package)`).toBe(
          FOUNDATION.directory,
        );
      }
    }
  });

  it("nothing in the platform or the shell tooling imports from site/ — the site is a consumer, not a dependency", () => {
    for (const directory of [...platformPackages().map((home) => home.directory), "internal"]) {
      for (const file of sourceFiles(directory)) {
        for (const specifier of importSpecifiers(file)) {
          if (!specifier.startsWith(".")) continue;
          const [target] = resolveRelative(file, specifier).split("/");
          expect(target, `${file} imports ${specifier}`).not.toBe("site");
        }
      }
    }
  });
});

describe("external companions (derived from the manifest)", () => {
  for (const capability of CAPABILITIES) {
    for (const [role, packageName] of Object.entries(capability.external ?? {})) {
      describe(`${capability.name}'s ${role} (${packageName})`, () => {
        const member = memberByPackageName(packageName);

        it("exists in the workspace — presence is asserted, publishability is not (it may stay private until it publishes)", () => {
          expect(member, `${packageName} is not a workspace member`).not.toBeNull();
        });

        it(`depends on ${capability.package}`, () => {
          expect(member?.manifest.dependencies?.[capability.package]).toBe("workspace:*");
        });

        it("imports the platform only through public subpaths — the same surface any npm consumer gets", () => {
          for (const file of sourceFiles(member!.directory)) {
            for (const specifier of importSpecifiers(file)) {
              const scoped = scopedPackageName(specifier);
              if (scoped === null || memberByPackageName(scoped) === null) continue;
              expect(isPublicImport(specifier, scoped), `${file} imports ${specifier}`).toBe(true);
            }
          }
        });
      });
    }
  }
});

describe("internal layering (derived from the manifest)", () => {
  for (const capability of CAPABILITIES) {
    if (capability.views.length === 0) continue;
    it(`${capability.name}: data modules never import its views (${capability.views.join(", ")}) — science and wire code must never compile a renderer; only the root surface and the view surfaces themselves may curate views`, () => {
      /* A view lives at src/<view>/ (a directory) or src/<view>.ts (a flat
         curation surface such as briefing's meteogram.ts); both forms are
         view code and both are off-limits to data modules. */
      const isViewFile = (file: string) =>
        capability.views.some(
          (view) =>
            file.startsWith(`${capability.directory}/src/${view}/`) ||
            file === `${capability.directory}/src/${view}.ts`,
        );
      const files = sourceFiles(capability.directory).filter(
        (file) => !isViewFile(file) && file !== `${capability.directory}/src/index.ts`,
      );
      for (const file of files) {
        for (const specifier of importSpecifiers(file)) {
          if (!specifier.startsWith(".")) continue;
          const resolved = resolveRelative(file, specifier);
          for (const view of capability.views) {
            expect(resolved, `${file} imports ${specifier}`).not.toMatch(
              new RegExp(`^${capability.directory}/src/${view}[/.]`),
            );
          }
        }
      }
    });
  }
});

describe("capability profiles", () => {
  it("briefing stays free of DOM, React, and browser modules — a framework import would break the Node-only ingest pipelines", () => {
    for (const file of sourceFiles("briefing")) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^(react|react-dom|svelte|vue)(\/|$)/,
        );
      }
    }
  });

  it("briefing/scene stays renderer-independent: no svg imports (tooltips and pixels must not drift apart), no node builtins (scene/ ships in browser bundles)", () => {
    for (const file of sourceFiles("briefing/src/scene")) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)svg\//);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^node:/);
      }
    }
  });

  it("briefing/compare-board's data shapes stay renderer-independent: only the subpath's own serializer files touch svg or theme code, and nothing pulls node builtins (the board ships in browser bundles)", () => {
    const serializerFiles = new Set([
      "briefing/src/compare-board/svg.ts",
      "briefing/src/compare-board/theme.ts",
      "briefing/src/compare-board/index.ts",
    ]);
    for (const file of sourceFiles("briefing/src/compare-board")) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^node:/);
        if (serializerFiles.has(file)) continue;
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /(^|\/)(svg|theme)(\/|\.js$)/,
        );
      }
    }
  });

  it("station's root and client never pull in server code, React, element registration, or stylesheets — those stay behind their subpaths", () => {
    const rootAndClient = [
      ...sourceFiles("station").filter(
        (file) =>
          !file.includes("station/src/server") &&
          !file.includes("station/src/react") &&
          !file.includes("station/src/elements"),
      ),
    ];
    for (const file of rootAndClient) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)server\//);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^react(\/|$)/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/register\.js$/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/\.css$/);
      }
    }
  });
});
