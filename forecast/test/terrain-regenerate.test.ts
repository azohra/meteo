// Opt-in (network): TERRAIN_LIVE=1 mise run //forecast:test terrain-regenerate

import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSites } from "../src/sites.js";
import { generate } from "../src/terrain.js";
import { useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

const repoPath = (relative: string): string =>
  join(new URL("../..", import.meta.url).pathname, relative);

describe.skipIf(!process.env.TERRAIN_LIVE)(
  "terrain regeneration against the committed document",
  () => {
    it(
      "reproduces scenarios/catalog/site-context.json byte for byte",
      { timeout: 600_000 },
      async () => {
        const committedText = readFileSync(
          repoPath("scenarios/catalog/site-context.json"),
          "utf-8",
        );
        const committed = JSON.parse(committedText) as { generatedAt: string };
        const sites = parseSites(readFileSync(repoPath("scenarios/catalog/sites.json"), "utf-8"));

        const outputPath = join(mkdtempSync(join(tmpdir(), "terrain-live-")), "site-context.json");
        const out: string[] = [];
        const err: string[] = [];
        const code = await generate(sites, outputPath, {
          generatedAt: committed.generatedAt,
          log: (line) => out.push(line),
          warn: (line) => err.push(line),
        });

        expect(code).toBe(0);
        expect(err, "the committed catalogue regenerates without warnings").toEqual([]);
        expect(readFileSync(outputPath, "utf-8")).toBe(committedText);
      },
    );
  },
);
