import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOOK_ONLY_CLASSES } from "./hook-only-classes.js";

const stationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(stationDir, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(stationDir, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

function emittedClasses(): { exact: Map<string, string[]>; prefixes: Set<string> } {
  const exact = new Map<string, string[]>();
  const prefixes = new Set<string>();
  for (const file of [
    ...sourceFiles("src/react"),
    ...sourceFiles("src/elements"),
    ...sourceFiles("src/scene"),
  ]) {
    // The scan is line-based; rejoin formatter wraps so a `className:` shares
    // a line with its (possibly ternary) value.
    const text = readFileSync(path.join(stationDir, file), "utf8")
      .replace(/([:=])\s*\n\s*/g, "$1 ")
      .replace(/\n\s*(?=[?:]\s)/g, " ");
    for (const line of text.split("\n")) {
      const contexts = line.matchAll(/(?:className|class)\s*[:=]/g);
      for (const context of contexts) {
        const rest = line.slice((context.index ?? 0) + context[0].length);
        for (const literal of rest.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
          // "@" stands in for `${…}` — it can never appear in a class name.
          const content = literal[2].replace(/\$\{[^}]*\}/g, "@");
          for (const token of content.split(/\s+/)) {
            if (/^meteo-[a-z0-9-]*-@$/.test(token)) prefixes.add(token.slice(0, -1));
            else if (/^meteo-[a-z0-9][a-z0-9-]*$/.test(token.replace(/@$/, ""))) {
              const name = token.replace(/@$/, "");
              exact.set(name, [...(exact.get(name) ?? []), file]);
            }
          }
        }
      }
    }
  }
  return { exact, prefixes };
}

function styledClasses(): Set<string> {
  const css = readFileSync(path.join(stationDir, "styles.css"), "utf8");
  return new Set([...css.matchAll(/\.(meteo-[a-z0-9-]+)/g)].map((match) => match[1]));
}

const { exact: emitted, prefixes } = emittedClasses();
const styled = styledClasses();
const hookOnly = new Set<string>(HOOK_ONLY_CLASSES);

describe("class-vocabulary contract", () => {
  it("collects a plausible vocabulary (the extractors did not silently break)", () => {
    expect(emitted.size).toBeGreaterThan(100);
    expect(styled.size).toBeGreaterThan(100);
    expect(prefixes).toContain("meteo-band-");
  });

  it("every emitted class is styled by styles.css or declared hook-only", () => {
    const unaccounted = [...emitted.keys()]
      .filter((name) => !styled.has(name) && !hookOnly.has(name))
      .sort()
      .map((name) => `${name} (${emitted.get(name)?.[0]})`);
    expect(unaccounted, "emitted but neither styled nor on the hook-only list").toEqual([]);
  });

  it("every dynamic class family resolves to at least one styled class", () => {
    for (const prefix of prefixes) {
      const hits = [...styled].filter((name) => name.startsWith(prefix));
      expect(hits.length, `no styled class matches the dynamic family ${prefix}*`).toBeGreaterThan(
        0,
      );
    }
  });

  it("every hook-only entry is actually emitted (no stale entries)", () => {
    const stale = HOOK_ONLY_CLASSES.filter((name) => !emitted.has(name));
    expect(stale, "hook-only entries no source file emits").toEqual([]);
  });

  it("no hook-only entry is styled (styling one promotes it off the list)", () => {
    const promoted = HOOK_ONLY_CLASSES.filter((name) => styled.has(name));
    expect(promoted, "hook-only entries styles.css now styles").toEqual([]);
  });
});
