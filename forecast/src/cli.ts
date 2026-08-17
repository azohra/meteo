#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BUILDERS, type RegistryBuildOptions } from "./builders/registry.js";
import {
  DEFAULT_OUTPUT_ROOT,
  PublisherConfigurationError,
  prepareOutputRoot,
  resolvePath,
  validateSitesPath,
  type PublisherConfig,
} from "./config.js";
import type { DatasetOptions } from "./dataset.js";
import { parseSites, type Site } from "./sites.js";

class CliFailure extends Error {}

class UsageError extends Error {}

const USAGE = "usage: meteo forecast <build|publish|terrain|runs-index|freshness|catalogue> ...";
const BUILD_USAGE =
  "usage: meteo forecast build (--model SLUG | --all) --sites PATH " +
  "[--output PATH] [--max-steps N] [--history|--no-history] [--dry-run]";
const TERRAIN_USAGE = "usage: meteo forecast terrain (--sites PATH [--output PATH] | --check)";
const RUNS_INDEX_USAGE = "usage: meteo forecast runs-index [--output PATH]";
const FRESHNESS_USAGE = "usage: meteo forecast freshness --model SLUG --manifest PATH";
const CATALOGUE_USAGE = "usage: meteo forecast catalogue [--output PATH]";
const PUBLISH_USAGE =
  "usage: meteo forecast publish --model SLUG [--data PATH] [--cache-live VALUE] [--cache-closed VALUE]";

export interface CliOverrides {
  runBuilder?: (slug: string, options: RegistryBuildOptions) => Promise<unknown>;
  terrain?: (sites: readonly Site[], outputPath: string) => Promise<number>;
  dataset?: DatasetOptions;
  now?: () => Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

type Print = (line: string) => void;

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`argument ${flag}: must be a positive integer`);
  }
  return parsed;
}

function loadSitesForCli(path: string): Site[] {
  validateSitesPath(path);
  try {
    return parseSites(readFileSync(path, "utf-8"), path);
  } catch (error) {
    if (error instanceof PublisherConfigurationError) {
      throw error;
    }
    throw new PublisherConfigurationError(
      `invalid sites file ${path}: ${(error as Error).message}`,
    );
  }
}

function requiredSitesPath(sites: string | undefined): string {
  const path = sites ?? process.env["METEO_SITES"];
  if (path === undefined || path === "") {
    throw new UsageError("a site catalogue is required: pass --sites PATH or set METEO_SITES");
  }
  return resolvePath(path);
}

async function withMaxStepsEnvironment<T>(
  maxSteps: number | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const name = "METEO_MAX_STEPS";
  const previous = process.env[name];
  try {
    if (maxSteps === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = String(maxSteps);
    }
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function selectedModels(model: string | undefined, all: boolean): readonly string[] {
  if (all) {
    return [...BUILDERS.keys()];
  }
  if (model === undefined || !BUILDERS.has(model)) {
    const available = [...BUILDERS.keys()].join(", ");
    throw new PublisherConfigurationError(
      `unknown model slug '${model}'; choose one of: ${available}`,
    );
  }
  return [model];
}

async function runRegisteredBuilder(slug: string, options: RegistryBuildOptions): Promise<unknown> {
  const build = BUILDERS.get(slug);
  if (build === undefined) {
    throw new PublisherConfigurationError(`no builder is registered for ${slug}`);
  }
  return build(options);
}

async function buildCommand(
  args: readonly string[],
  overrides: CliOverrides,
  stdout: Print,
  stderr: Print,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      model: { type: "string" },
      all: { type: "boolean", default: false },
      sites: { type: "string" },
      output: { type: "string", default: DEFAULT_OUTPUT_ROOT },
      "max-steps": { type: "string" },
      history: { type: "boolean", default: false },
      "no-history": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (values.model !== undefined && values.all) {
    throw new UsageError("argument --all: not allowed with argument --model");
  }
  if (values.model === undefined && !values.all) {
    throw new UsageError("one of the arguments --model --all is required");
  }
  if (values.history && values["no-history"]) {
    throw new UsageError("argument --no-history: not allowed with argument --history");
  }

  const models = selectedModels(values.model, values.all ?? false);
  const maxSteps =
    values["max-steps"] === undefined
      ? undefined
      : parsePositiveInteger("--max-steps", values["max-steps"]);
  const history = !values["no-history"];
  const config: PublisherConfig = {
    sitesPath: requiredSitesPath(values.sites),
    outputRoot: resolvePath(values.output!),
    history,
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
  const sites = loadSitesForCli(config.sitesPath);
  prepareOutputRoot(config.outputRoot, { create: !values["dry-run"] });

  if (values["dry-run"]) {
    const cap = config.maxSteps ? `, capped at ${config.maxSteps} step(s)` : "";
    const archives = config.history ? "" : ", skipping history archives";
    stdout(
      `Would build ${models.join(", ")} for ${sites.length} site(s) from ` +
        `${config.sitesPath} into ${config.outputRoot}${cap}${archives}.`,
    );
    return 0;
  }

  const runBuilder = overrides.runBuilder ?? runRegisteredBuilder;
  const buildOptions: RegistryBuildOptions = {
    sitesPath: config.sitesPath,
    outputRoot: config.outputRoot,
    history: config.history,
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
  await withMaxStepsEnvironment(config.maxSteps, async () => {
    for (const slug of models) {
      try {
        await runBuilder(slug, buildOptions);
      } catch (error) {
        if (error instanceof PublisherConfigurationError) {
          throw error;
        }
        if (process.env["METEO_TRACEBACK"]) {
          stderr(error instanceof Error && error.stack ? error.stack : String(error));
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new CliFailure(`${slug} build failed: ${message}`, { cause: error });
      }
    }
  });
  return 0;
}

async function publishCommand(
  args: readonly string[],
  overrides: CliOverrides,
  stdout: Print,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      model: { type: "string" },
      data: { type: "string", default: "data" },
      // Cache lifetimes are deployment choices; the TRIAL defaults live
      // with the upload module.
      "cache-live": { type: "string" },
      "cache-closed": { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.model === undefined) {
    throw new UsageError("the following arguments are required: --model");
  }
  const { publishModel } = await import("./upload.js");
  try {
    const result = await publishModel(values.model, {
      ...(overrides.dataset ?? {}),
      dataRoot: resolvePath(values.data!),
      now: overrides.now,
      cacheLifetimes: { live: values["cache-live"], closedMonths: values["cache-closed"] },
    });
    if (result.verdict === "nothing") {
      stdout(`No new ${values.model} output to upload.`);
    } else if (result.verdict === "stale") {
      stdout(
        `Published ${values.model} manifest is not older than the local one; skipping upload.`,
      );
    } else {
      stdout(`Published ${result.objects} objects for ${values.model}; runs.json advanced.`);
    }
  } catch (error) {
    if (error instanceof PublisherConfigurationError) {
      throw error;
    }
    throw new CliFailure((error as Error).message, { cause: error });
  }
  return 0;
}

async function runsIndexCommand(args: readonly string[], overrides: CliOverrides): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { output: { type: "string", default: "data/runs.json" } },
    allowPositionals: false,
  });
  const dataset = await import("./dataset.js");
  const publish = await import("./publish.js");
  const { cataloguedModelSlugs } = await import("./catalogue.js");
  try {
    const reader = await dataset.prefetchedManifestReader(
      cataloguedModelSlugs(),
      overrides.dataset ?? {},
    );
    publish.writeRunsIndex(reader, resolvePath(values.output!));
  } catch (error) {
    if (error instanceof PublisherConfigurationError) {
      throw error;
    }
    throw new CliFailure((error as Error).message, { cause: error });
  }
  return 0;
}

async function freshnessCommand(
  args: readonly string[],
  overrides: CliOverrides,
  stdout: Print,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { model: { type: "string" }, manifest: { type: "string" } },
    allowPositionals: false,
  });
  if (values.model === undefined) {
    throw new UsageError("the following arguments are required: --model");
  }
  if (values.manifest === undefined) {
    throw new UsageError("the following arguments are required: --manifest");
  }
  const dataset = await import("./dataset.js");
  try {
    const local = JSON.parse(readFileSync(resolvePath(values.manifest), "utf-8")) as {
      generatedAt: string;
    };
    const published = await dataset.publishedManifest(values.model, overrides.dataset ?? {});
    const fresh = published === null || published.generatedAt < local.generatedAt;
    stdout(fresh ? "fresh" : "stale");
  } catch (error) {
    if (error instanceof PublisherConfigurationError) {
      throw error;
    }
    throw new CliFailure((error as Error).message, { cause: error });
  }
  return 0;
}

async function catalogueCommand(args: readonly string[], stdout: Print): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { output: { type: "string" } },
    allowPositionals: false,
  });
  const { packagedModelsPath } = await import("./catalogue.js");
  const payload = readFileSync(packagedModelsPath(), "utf-8");
  if (values.output === undefined) {
    stdout(payload.replace(/\n$/, ""));
    return 0;
  }
  const output = resolvePath(values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, payload);
  return 0;
}

async function terrainCommand(
  args: readonly string[],
  overrides: CliOverrides,
  stdout: Print,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      sites: { type: "string" },
      output: { type: "string" },
      check: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (values.check) {
    if (values.sites !== undefined || values.output !== undefined) {
      throw new UsageError("--check reads the published dataset; it takes no --sites or --output");
    }
    const { publishedContextFresh } = await import("./context-freshness.js");
    try {
      stdout((await publishedContextFresh(overrides.dataset ?? {})) ? "fresh" : "stale");
    } catch (error) {
      if (error instanceof PublisherConfigurationError) {
        throw error;
      }
      throw new CliFailure((error as Error).message, { cause: error });
    }
    return 0;
  }
  const sitesPath = requiredSitesPath(values.sites);
  const sites = loadSitesForCli(sitesPath);
  const output =
    values.output === undefined
      ? join(dirname(sitesPath), "site-context.json")
      : resolvePath(values.output);
  const generate = overrides.terrain ?? (await import("./terrain.js")).generate;
  return generate(sites, output);
}

function usageFor(command: string | undefined): string {
  switch (command) {
    case "build":
      return BUILD_USAGE;
    case "terrain":
      return TERRAIN_USAGE;
    case "runs-index":
      return RUNS_INDEX_USAGE;
    case "freshness":
      return FRESHNESS_USAGE;
    case "catalogue":
      return CATALOGUE_USAGE;
    case "publish":
      return PUBLISH_USAGE;
    default:
      return USAGE;
  }
}

export async function main(argv: readonly string[], overrides: CliOverrides = {}): Promise<number> {
  const stdout = overrides.stdout ?? ((line: string) => console.log(line));
  const stderr = overrides.stderr ?? ((line: string) => console.error(line));
  const [capability, command, ...rest] = argv;
  try {
    if (capability !== "forecast") {
      throw new UsageError(
        capability === undefined
          ? "a capability is required (forecast)"
          : `unknown capability '${capability}' (expected: forecast)`,
      );
    }
    switch (command) {
      case "build":
        return await buildCommand(rest, overrides, stdout, stderr);
      case "terrain":
        return await terrainCommand(rest, overrides, stdout);
      case "runs-index":
        return await runsIndexCommand(rest, overrides);
      case "freshness":
        return await freshnessCommand(rest, overrides, stdout);
      case "catalogue":
        return await catalogueCommand(rest, stdout);
      case "publish":
        return await publishCommand(rest, overrides, stdout);
      default:
        throw new UsageError(
          command === undefined
            ? "a forecast command is required"
            : `unknown forecast command '${command}'`,
        );
    }
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      stderr(usageFor(command));
      stderr(`meteo: error: ${(error as Error).message}`);
      return 2;
    }
    if (error instanceof PublisherConfigurationError || error instanceof CliFailure) {
      stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined) {
  let isEntryPoint = false;
  try {
    isEntryPoint = pathToFileURL(realpathSync(invokedPath)).href === import.meta.url;
  } catch {
    isEntryPoint = false;
  }
  if (isEntryPoint) {
    process.exitCode = await main(process.argv.slice(2));
  }
}
