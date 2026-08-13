import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILDERS, type RegistryBuildOptions } from "../src/builders/registry.js";
import { main } from "../src/cli.js";
import { PublisherConfigurationError, prepareOutputRoot } from "../src/config.js";
import type { PublishedObjectStore } from "../src/migrate.js";
import { packagedModelsPath } from "../src/catalogue.js";
import { stubFetch, useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

const SITE = {
  slug: "test-hill",
  name: "Test Hill",
  latitude: 49.0,
  longitude: -117.0,
  timeZone: "America/Vancouver",
};

function writeSites(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 2, sites: [SITE] }));
  return path;
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "meteo-cli-"));
}

interface Capture {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  out: string[];
  err: string[];
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return { stdout: (line) => out.push(line), stderr: (line) => err.push(line), out, err };
}

function neverDispatch(): never {
  throw new Error("this invocation must not dispatch a builder");
}

/** Snapshot-and-restore for the environment the CLI bridges or reads. */
const MANAGED_ENV = ["METEO_MAX_STEPS", "METEO_TRACEBACK", "METEO_SITES"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]));
  for (const name of MANAGED_ENV) {
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of MANAGED_ENV) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
});

describe("the builder registry", () => {
  it("covers every catalogued model, in exact catalogue order", () => {
    // The catalogue ships with the package (models.json, exported as
    // "@azohra/meteo.forecast/models.json") — the registry answers to it.
    const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
      models: { slug: string }[];
      smokeModels?: { slug: string }[];
      observationModels?: { slug: string }[];
    };
    // Profile models in catalogue order, then the smoke and observation
    // datasets — every dataset the catalogue declares is dispatchable,
    // nothing more.
    expect([...BUILDERS.keys()]).toEqual([
      ...catalogue.models.map((model) => model.slug),
      ...(catalogue.smokeModels ?? []).map((model) => model.slug),
      ...(catalogue.observationModels ?? []).map((model) => model.slug),
    ]);
  });

  it("factories take exactly the options argument — never the platform's argv", async () => {
    // Regression: the registry once invoked builder mains whose
    // argparse read sys.argv — the platform CLI's own arguments — so every
    // scheduled ensemble build died at parse_args(2) behind the workflow's
    // ::warning mask. The TS builders parse no argv at all; hold the
    // registry to that shape, and prove the CLI derives every input from
    // its explicit argv parameter while process.argv stands contaminated.
    for (const [slug, factory] of BUILDERS) {
      expect(factory.length, `${slug} factory arity`).toBe(1);
    }

    const previousArgv = process.argv;
    process.argv = ["node", "meteo", "forecast", "build", "--model", "reps", "--max-steps", "1"];
    try {
      const tmp = scratch();
      const sites = writeSites(join(tmp, "sites.json"));
      const calls: Array<[string, RegistryBuildOptions]> = [];
      const io = capture();
      const result = await main(
        [
          "forecast",
          "build",
          "--model",
          "geps",
          "--sites",
          sites,
          "--output",
          join(tmp, "out"),
          "--max-steps",
          "3",
        ],
        { runBuilder: async (slug, options) => void calls.push([slug, options]), ...io },
      );
      expect(result).toBe(0);
      expect(calls).toEqual([
        ["geps", { sitesPath: sites, outputRoot: join(tmp, "out"), history: true, maxSteps: 3 }],
      ]);
    } finally {
      process.argv = previousArgv;
    }
  });
});

describe("meteo forecast build", () => {
  it("dry-run accepts external sites and output without writing or dispatching", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "club", "launches.json"));
    const output = join(tmp, "publish", "profiles");
    const io = capture();

    const result = await main(
      [
        "forecast",
        "build",
        "--model",
        "hrrr-conus",
        "--sites",
        sites,
        "--output",
        output,
        "--max-steps",
        "2",
        "--dry-run",
      ],
      { runBuilder: neverDispatch, ...io },
    );

    expect(result).toBe(0);
    expect(existsSync(output)).toBe(false);
    const stdout = io.out.join("\n");
    expect(stdout).toContain(sites);
    expect(stdout).toContain(output);
    expect(stdout).toContain("capped at 2 step(s)");
  });

  it("dispatch passes explicit paths and max-steps, bridging the env without leaks", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "launches.json"));
    const output = join(tmp, "static");
    const calls: Array<[string, RegistryBuildOptions, string | undefined]> = [];
    process.env["METEO_MAX_STEPS"] = "91";

    const result = await main(
      [
        "forecast",
        "build",
        "--model",
        "gfs",
        "--sites",
        sites,
        "--output",
        output,
        "--max-steps",
        "3",
      ],
      {
        runBuilder: async (slug, options) =>
          void calls.push([slug, options, process.env["METEO_MAX_STEPS"]]),
        ...capture(),
      },
    );

    expect(result).toBe(0);
    expect(calls).toEqual([
      ["gfs", { sitesPath: sites, outputRoot: output, history: true, maxSteps: 3 }, "3"],
    ]);
    expect(existsSync(output)).toBe(true);
    expect(process.env["METEO_MAX_STEPS"]).toBe("91");
  });

  it("names the model in the one-line failure and restores the environment", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    process.env["METEO_MAX_STEPS"] = "91";
    const io = capture();

    const result = await main(
      [
        "forecast",
        "build",
        "--model",
        "gfs",
        "--sites",
        sites,
        "--output",
        join(tmp, "out"),
        "--max-steps",
        "2",
      ],
      {
        runBuilder: async () => {
          throw new Error("boom");
        },
        ...io,
      },
    );

    expect(result).toBe(1);
    expect(io.err.join("\n")).toContain("gfs build failed: boom");
    expect(process.env["METEO_MAX_STEPS"]).toBe("91");
  });

  it("METEO_TRACEBACK opts stderr into the full stack before the one-liner", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };

    // Without the opt-in: only the one-line failure.
    const quiet = capture();
    expect(
      await main(["forecast", "build", "--model", "gfs", "--sites", sites, "--output", tmp], {
        runBuilder: failing,
        ...quiet,
      }),
    ).toBe(1);
    expect(quiet.err.join("\n")).not.toMatch(/\n\s+at /);

    process.env["METEO_TRACEBACK"] = "1";
    const loud = capture();
    expect(
      await main(["forecast", "build", "--model", "gfs", "--sites", sites, "--output", tmp], {
        runBuilder: failing,
        ...loud,
      }),
    ).toBe(1);
    const stderr = loud.err.join("\n");
    expect(stderr).toMatch(/Error: boom\n\s+at /);
    expect(stderr).toContain("gfs build failed: boom");
    expect(stderr.indexOf("at ")).toBeLessThan(stderr.indexOf("gfs build failed"));
  });

  it.each([
    [["--model", "not-a-model"], "unknown model slug 'not-a-model'"],
    [["--model", "gfs", "--sites", "missing.json"], "sites file does not exist"],
  ])("rejects %j with a directive error", async (extra, message) => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const io = capture();

    const result = await main(
      ["forecast", "build", "--sites", sites, "--output", join(tmp, "out"), ...extra],
      { runBuilder: neverDispatch, ...io },
    );

    expect(result).toBe(1);
    expect(io.err.join("\n")).toContain(message);
  });

  it("names every valid slug when rejecting an unknown one", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const io = capture();

    await main(
      ["forecast", "build", "--model", "nosuch", "--sites", sites, "--output", join(tmp, "out")],
      { runBuilder: neverDispatch, ...io },
    );

    const stderr = io.err.join("\n");
    for (const slug of BUILDERS.keys()) {
      expect(stderr).toContain(slug);
    }
  });

  it("requires exactly one of --model and --all", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const base = ["forecast", "build", "--sites", sites, "--output", join(tmp, "out")];

    const neither = capture();
    expect(await main(base, { runBuilder: neverDispatch, ...neither })).toBe(2);
    expect(neither.err.join("\n")).toContain("one of the arguments --model --all is required");

    const both = capture();
    expect(
      await main([...base, "--model", "gfs", "--all"], { runBuilder: neverDispatch, ...both }),
    ).toBe(2);
    expect(both.err.join("\n")).toContain("not allowed with argument --model");
  });

  it("requires a site catalogue, naming both spellings of the fix", async () => {
    // No default catalogue: which sites an operator publishes is their
    // decision, and the directive error says how to make it.
    const io = capture();
    const result = await main(["forecast", "build", "--model", "gfs", "--dry-run"], {
      runBuilder: neverDispatch,
      ...io,
    });
    expect(result).toBe(2);
    const stderr = io.err.join("\n");
    expect(stderr).toContain("--sites");
    expect(stderr).toContain("METEO_SITES");
  });

  it("falls back to METEO_SITES per the METEO_* grammar", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    process.env["METEO_SITES"] = sites;
    const calls: Array<[string, RegistryBuildOptions]> = [];

    const result = await main(
      ["forecast", "build", "--model", "gfs", "--output", join(tmp, "out")],
      { runBuilder: async (slug, options) => void calls.push([slug, options]), ...capture() },
    );

    expect(result).toBe(0);
    expect(calls).toEqual([
      ["gfs", { sitesPath: sites, outputRoot: join(tmp, "out"), history: true }],
    ]);
  });

  it("--sites wins over METEO_SITES", async () => {
    const tmp = scratch();
    const explicit = writeSites(join(tmp, "explicit.json"));
    process.env["METEO_SITES"] = join(tmp, "does-not-exist.json");
    const calls: Array<[string, RegistryBuildOptions]> = [];

    const result = await main(
      ["forecast", "build", "--model", "gfs", "--sites", explicit, "--output", join(tmp, "out")],
      { runBuilder: async (slug, options) => void calls.push([slug, options]), ...capture() },
    );

    expect(result).toBe(0);
    expect(calls[0]?.[1].sitesPath).toBe(explicit);
  });

  it("--no-history threads the operator's choice; the default is on", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const calls: Array<RegistryBuildOptions> = [];
    const run = (extra: string[]) =>
      main(["forecast", "build", "--model", "gfs", "--sites", sites, "--output", tmp, ...extra], {
        runBuilder: async (_slug, options) => void calls.push(options),
        ...capture(),
      });

    expect(await run([])).toBe(0);
    expect(await run(["--history"])).toBe(0);
    expect(await run(["--no-history"])).toBe(0);
    expect(calls.map((options) => options.history)).toEqual([true, true, false]);
  });

  it("rejects --history combined with --no-history", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const io = capture();
    expect(
      await main(
        ["forecast", "build", "--model", "gfs", "--sites", sites, "--history", "--no-history"],
        { runBuilder: neverDispatch, ...io },
      ),
    ).toBe(2);
    expect(io.err.join("\n")).toContain("--no-history");
  });

  it.each(["--max-steps=0", "--max-steps=-2", "--max-steps=x"])(
    "rejects %s as a usage error",
    async (flag) => {
      const tmp = scratch();
      const sites = writeSites(join(tmp, "sites.json"));
      const io = capture();

      const result = await main(
        [
          "forecast",
          "build",
          "--model",
          "gfs",
          "--sites",
          sites,
          "--output",
          join(tmp, "out"),
          flag,
        ],
        { runBuilder: neverDispatch, ...io },
      );

      expect(result).toBe(2);
      expect(io.err.join("\n")).toContain("must be a positive integer");
    },
  );

  it("rejects unknown options as usage errors", async () => {
    const io = capture();
    expect(await main(["forecast", "build", "--model", "gfs", "--frobnicate"], io)).toBe(2);
    expect(io.err.join("\n")).toContain("--frobnicate");
  });

  it("--all dispatches every catalogued model in catalogue order", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const calls: string[] = [];

    const result = await main(
      [
        "forecast",
        "build",
        "--all",
        "--sites",
        sites,
        "--output",
        join(tmp, "out"),
        "--max-steps",
        "1",
      ],
      { runBuilder: async (slug) => void calls.push(slug), ...capture() },
    );

    expect(result).toBe(0);
    expect(calls).toEqual([...BUILDERS.keys()]);
  });

  it("stops at the first failing model of an --all run", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const calls: string[] = [];
    const io = capture();

    const result = await main(
      ["forecast", "build", "--all", "--sites", sites, "--output", join(tmp, "out")],
      {
        runBuilder: async (slug) => {
          calls.push(slug);
          if (slug === "hrrr-conus") {
            throw new Error("boom");
          }
        },
        ...io,
      },
    );

    expect(result).toBe(1);
    expect(calls).toEqual(["hrdps-west", "hrdps-continental", "hrrr-conus"]);
    expect(io.err.join("\n")).toContain("hrrr-conus build failed: boom");
  });

  it("rejects an output path that is not a directory", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const output = join(tmp, "not-a-directory");
    writeFileSync(output, "occupied");
    const io = capture();

    const result = await main(
      ["forecast", "build", "--model", "gfs", "--sites", sites, "--output", output],
      { runBuilder: neverDispatch, ...io },
    );

    expect(result).toBe(1);
    expect(io.err.join("\n")).toContain(`output path is not a directory: ${output}`);
  });

  it.skipIf(process.getuid?.() === 0)(
    "rejects an unwritable output directory with the path named",
    async () => {
      const tmp = scratch();
      const sites = writeSites(join(tmp, "sites.json"));
      const output = join(tmp, "read-only");
      mkdirSync(output);
      chmodSync(output, 0o555);
      const io = capture();

      try {
        const result = await main(
          ["forecast", "build", "--model", "gfs", "--sites", sites, "--output", output],
          { runBuilder: neverDispatch, ...io },
        );
        expect(result).toBe(1);
        expect(io.err.join("\n")).toContain(`output directory is not writable: ${output}`);
      } finally {
        chmodSync(output, 0o755);
      }
    },
  );
});

describe("prepareOutputRoot", () => {
  it("refuses a root whose nearest existing ancestor is not a directory", () => {
    const tmp = scratch();
    const file = join(tmp, "occupied");
    writeFileSync(file, "");
    expect(() => prepareOutputRoot(join(file, "nested", "out"), { create: true })).toThrow(
      PublisherConfigurationError,
    );
  });

  it("creates missing roots only when asked to", () => {
    const tmp = scratch();
    const root = join(tmp, "deep", "output");
    prepareOutputRoot(root, { create: false });
    expect(existsSync(root)).toBe(false);
    prepareOutputRoot(root, { create: true });
    expect(existsSync(root)).toBe(true);
  });
});

describe("meteo forecast scenarios (removed from the published CLI)", () => {
  it("is an unknown command: scenario tooling lives in the source checkout", async () => {
    // The scenario core stays exported from the package; the CLI verb and
    // the repo-root discovery moved to the checkout's own wiring
    // (`pnpm scenarios:generate` / `pnpm scenarios:check`).
    const io = capture();
    expect(await main(["forecast", "scenarios", "check"], io)).toBe(2);
    expect(io.err.join("\n")).toContain("unknown forecast command 'scenarios'");
  });
});

describe("meteo forecast runs-index", () => {
  const MANIFEST = {
    model: "gfs",
    referenceTime: "2026-08-09T06:00:00Z",
    generatedAt: "2026-08-09T09:12:00Z",
  };

  it("regenerates runs.json from the packaged catalogue's published manifests", async () => {
    const tmp = scratch();
    const output = join(tmp, "data", "runs.json");
    const slugs = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
      models: { slug: string }[];
      smokeModels?: { slug: string }[];
      observationModels?: { slug: string }[];
    };
    const datasets = [
      ...slugs.models,
      ...(slugs.smokeModels ?? []),
      ...(slugs.observationModels ?? []),
    ];
    // One manifest read per catalogued dataset: gfs published, the rest
    // never have (404 → absent from the index, never an error).
    const wire = stubFetch(
      datasets.map(({ slug }) =>
        slug === "gfs" ? { status: 200, body: JSON.stringify(MANIFEST) } : { status: 404 },
      ),
    );

    const result = await main(["forecast", "runs-index", "--output", output], {
      dataset: { fetch: wire.fetch },
      ...capture(),
    });

    expect(result).toBe(0);
    expect(wire.requests).toHaveLength(datasets.length);
    const index = JSON.parse(readFileSync(output, "utf-8")) as {
      schemaVersion: number;
      runs: Record<string, { referenceTime: string; generatedAt: string }>;
    };
    expect(index.schemaVersion).toBe(1);
    expect(index.runs).toEqual({
      gfs: { referenceTime: MANIFEST.referenceTime, generatedAt: MANIFEST.generatedAt },
    });
  });

  it("a broken read fails the command instead of writing a reset index", async () => {
    const tmp = scratch();
    const output = join(tmp, "runs.json");
    const wire = stubFetch([{ status: 403, headers: { "cf-mitigated": "challenge" } }]);
    const io = capture();

    const result = await main(["forecast", "runs-index", "--output", output], {
      dataset: { fetch: wire.fetch },
      ...io,
    });

    expect(result).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(io.err.join("\n")).toContain("Cloudflare");
  });
});

describe("meteo forecast freshness", () => {
  function localManifest(generatedAt: string): string {
    const tmp = scratch();
    const path = join(tmp, "manifest.json");
    writeFileSync(path, JSON.stringify({ model: "gfs", generatedAt }));
    return path;
  }

  function published(generatedAt: string): string {
    return JSON.stringify({
      model: "gfs",
      referenceTime: "2026-08-09T06:00:00Z",
      generatedAt,
    });
  }

  it("prints exactly `fresh` when nothing is published", async () => {
    const manifest = localManifest("2026-08-09T09:12:00Z");
    const wire = stubFetch([{ status: 404 }]);
    const io = capture();

    const result = await main(["forecast", "freshness", "--model", "gfs", "--manifest", manifest], {
      dataset: { fetch: wire.fetch },
      ...io,
    });

    expect(result).toBe(0);
    expect(io.out).toEqual(["fresh"]);
  });

  it("prints exactly `fresh` when the published manifest is older", async () => {
    const manifest = localManifest("2026-08-09T09:12:00Z");
    const wire = stubFetch([{ status: 200, body: published("2026-08-09T03:00:00Z") }]);
    const io = capture();

    expect(
      await main(["forecast", "freshness", "--model", "gfs", "--manifest", manifest], {
        dataset: { fetch: wire.fetch },
        ...io,
      }),
    ).toBe(0);
    expect(io.out).toEqual(["fresh"]);
  });

  it("prints exactly `stale` when the published manifest is not older — still exit 0", async () => {
    const manifest = localManifest("2026-08-09T09:12:00Z");
    const wire = stubFetch([{ status: 200, body: published("2026-08-09T09:12:00Z") }]);
    const io = capture();

    expect(
      await main(["forecast", "freshness", "--model", "gfs", "--manifest", manifest], {
        dataset: { fetch: wire.fetch },
        ...io,
      }),
    ).toBe(0);
    expect(io.out).toEqual(["stale"]);
  });

  it("a broken read exits nonzero WITHOUT a verdict — never `stale`", async () => {
    // The upload flow skips on `stale`; a transport failure that printed
    // stale would silently stop publication. It must fail loudly instead.
    const manifest = localManifest("2026-08-09T09:12:00Z");
    const wire = stubFetch([new Error("reset"), new Error("reset"), new Error("reset")]);
    const io = capture();

    const result = await main(["forecast", "freshness", "--model", "gfs", "--manifest", manifest], {
      dataset: { fetch: wire.fetch, sleep: async () => {} },
      ...io,
    });

    expect(result).toBe(1);
    expect(io.out).toEqual([]);
  });

  it("an unreadable local manifest is a failure, not a verdict", async () => {
    const io = capture();
    const result = await main(
      ["forecast", "freshness", "--model", "gfs", "--manifest", join(scratch(), "missing.json")],
      { dataset: { fetch: stubFetch([]).fetch }, ...io },
    );
    expect(result).toBe(1);
    expect(io.out).toEqual([]);
  });

  it("requires --model and --manifest", async () => {
    expect(await main(["forecast", "freshness", "--manifest", "x.json"], capture())).toBe(2);
    expect(await main(["forecast", "freshness", "--model", "gfs"], capture())).toBe(2);
  });
});

describe("meteo forecast catalogue", () => {
  it("emits the packaged models.json to --output", async () => {
    const tmp = scratch();
    const output = join(tmp, "published", "models.json");

    const result = await main(["forecast", "catalogue", "--output", output], capture());

    expect(result).toBe(0);
    expect(readFileSync(output, "utf-8")).toBe(readFileSync(packagedModelsPath(), "utf-8"));
  });

  it("prints the catalogue to stdout without --output", async () => {
    const io = capture();
    expect(await main(["forecast", "catalogue"], io)).toBe(0);
    const catalogue = JSON.parse(io.out.join("\n")) as { models: unknown[] };
    expect(catalogue.models.length).toBeGreaterThan(0);
  });
});

describe("meteo forecast migrate", () => {
  function memoryStore(): { store: PublishedObjectStore; puts: string[] } {
    const puts: string[] = [];
    return {
      store: {
        fetchPublished: async () => null,
        putObject: (key) => void puts.push(key),
        s3Mode: () => false,
      },
      puts,
    };
  }

  it("validates the slug against the registry", async () => {
    const io = capture();
    const result = await main(["forecast", "migrate", "--model", "nosuch", "--site", "test-hill"], {
      store: memoryStore().store,
      ...io,
    });
    expect(result).toBe(1);
    expect(io.err.join("\n")).toContain("unknown model slug 'nosuch'");
    expect(io.err.join("\n")).toContain("hrdps-west");
  });

  it("requires --model", async () => {
    const io = capture();
    expect(await main(["forecast", "migrate", "--site", "test-hill"], io)).toBe(2);
    expect(io.err.join("\n")).toContain("--model");
  });

  it("dry-runs an empty dataset to a report, writing nothing", async () => {
    const { store, puts } = memoryStore();
    const io = capture();

    const result = await main(["forecast", "migrate", "--model", "gfs", "--site", "test-hill"], {
      store,
      ...io,
    });

    expect(result).toBe(0);
    const stdout = io.out.join("\n");
    expect(stdout).toContain("gfs/test-hill: no current document published.");
    expect(stdout).toContain("dry run — would upload nothing.");
    expect(puts).toEqual([]);
  });

  it("defaults the site list to every catalogued site", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const { store } = memoryStore();
    const io = capture();

    const result = await main(["forecast", "migrate", "--model", "gfs", "--sites", sites], {
      store,
      ...io,
    });

    expect(result).toBe(0);
    expect(io.out.join("\n")).toContain("gfs/test-hill: no current document published.");
  });

  it("requires a site catalogue when no --site is given", async () => {
    const io = capture();
    const result = await main(["forecast", "migrate", "--model", "gfs"], {
      store: memoryStore().store,
      ...io,
    });
    expect(result).toBe(2);
    expect(io.err.join("\n")).toContain("METEO_SITES");
  });

  it("accepts --members on an ensemble model", async () => {
    const { store, puts } = memoryStore();
    const io = capture();

    const result = await main(
      ["forecast", "migrate", "--model", "reps", "--site", "test-hill", "--members", "21"],
      { store, ...io },
    );

    expect(result).toBe(0);
    expect(io.out.join("\n")).toContain("reps/test-hill: no current document published.");
    expect(puts).toEqual([]);
  });

  it("refuses --members where the catalogue declares no ensemble", async () => {
    const io = capture();
    const result = await main(
      ["forecast", "migrate", "--model", "gfs", "--site", "test-hill", "--members", "21"],
      { store: memoryStore().store, ...io },
    );
    expect(result).toBe(1);
    expect(io.err.join("\n")).toContain("'gfs' is deterministic");
  });

  it("refuses a --members value that is not a whole count", async () => {
    const io = capture();
    const result = await main(
      ["forecast", "migrate", "--model", "reps", "--site", "test-hill", "--members", "twenty"],
      { store: memoryStore().store, ...io },
    );
    expect(result).toBe(2);
    expect(io.err.join("\n")).toContain("--members");
  });
});

describe("meteo forecast terrain", () => {
  it("wires the parsed catalogue and resolved output into generate", async () => {
    const tmp = scratch();
    const sites = writeSites(join(tmp, "sites.json"));
    const output = join(tmp, "site-context.json");
    const calls: Array<[readonly unknown[], string]> = [];

    const result = await main(["forecast", "terrain", "--sites", sites, "--output", output], {
      terrain: async (parsedSites, outputPath) => {
        calls.push([parsedSites, outputPath]);
        return 0;
      },
      ...capture(),
    });

    expect(result).toBe(0);
    expect(calls).toEqual([[[SITE], output]]);
  });

  it("defaults --output to site-context.json beside the sites file", async () => {
    // The context describes exactly the catalogue it sits next to — the
    // pair travels together, wherever the operator keeps their sites.
    const tmp = scratch();
    const sites = writeSites(join(tmp, "club", "launches.json"));
    const calls: string[] = [];

    const result = await main(["forecast", "terrain", "--sites", sites], {
      terrain: async (_parsedSites, outputPath) => {
        calls.push(outputPath);
        return 0;
      },
      ...capture(),
    });

    expect(result).toBe(0);
    expect(calls).toEqual([join(tmp, "club", "site-context.json")]);
  });

  it("requires a site catalogue like build does", async () => {
    const io = capture();
    expect(await main(["forecast", "terrain"], { terrain: async () => 0, ...io })).toBe(2);
    expect(io.err.join("\n")).toContain("METEO_SITES");
  });
});

describe("meteo forecast repack (tombstone removed)", () => {
  it("is simply an unknown command — the ledger carries the history", async () => {
    const io = capture();
    const result = await main(["forecast", "repack", "--model", "gfs", "--year", "2024"], io);
    expect(result).toBe(2);
    expect(io.err.join("\n")).toContain("unknown forecast command 'repack'");
  });
});

describe("the platform grammar", () => {
  it("requires the forecast capability", async () => {
    const io = capture();
    expect(await main([], io)).toBe(2);
    expect(await main(["observe", "build"], capture())).toBe(2);
    expect(io.err.join("\n")).toContain("forecast");
  });

  it("requires a known forecast command", async () => {
    const io = capture();
    expect(await main(["forecast"], io)).toBe(2);
    expect(await main(["forecast", "explode"], capture())).toBe(2);
  });
});
