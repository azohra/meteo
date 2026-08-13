import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseManifestJson,
  parseModelCatalogueJson,
  parseRunsIndexJson,
  parseSiteContextJson,
  parseSiteForecastJson,
  parseSitesCatalogueJson,
} from "../src/contract.js";
import { parseHistoryIndexJson, splitHistoryArchive } from "../src/history/index.js";

const SAMPLE_ROOT = new URL("../../site/public/data-sample/", import.meta.url);
const MODEL = "hrdps-continental";
const SITES = ["test-hill", "test-ridge", "test-valley"];

const read = (relative: string): string => readFileSync(new URL(relative, SAMPLE_ROOT), "utf8");
const readBytes = (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(relative, SAMPLE_ROOT)));
const list = (relative: string): string[] => readdirSync(new URL(relative, SAMPLE_ROOT)).sort();

describe("committed sample dataset against the published contract", () => {
  it("models.json is the packaged model catalogue shape", () => {
    const catalogue = parseModelCatalogueJson(read("models.json"));
    expect(catalogue).not.toBeNull();
    expect(catalogue?.models.map((model) => model.slug)).toContain(MODEL);
  });

  it("sites.json and site-context.json mirror the dataset root the recipe curls", () => {
    const sites = parseSitesCatalogueJson(read("sites.json"));
    expect(sites).not.toBeNull();
    const context = parseSiteContextJson(read("site-context.json"));
    expect(context).not.toBeNull();
    const slugs = sites?.sites.map((site) => site.slug).sort();
    expect(Object.keys(context?.sites ?? {}).sort()).toEqual(slugs);
  });

  it("runs.json parses and names the sample's one published run", () => {
    const runs = parseRunsIndexJson(read("runs.json"));
    expect(runs).not.toBeNull();
    expect(Object.keys(runs?.runs ?? {})).toEqual([MODEL]);
  });

  it("the model manifest parses and lists exactly the teaching sites", () => {
    const manifest = parseManifestJson(read(`${MODEL}/manifest.json`));
    expect(manifest).not.toBeNull();
    expect(manifest?.sites.map((site) => site.slug).sort()).toEqual(SITES);
  });

  it("every site document parses as a site forecast", () => {
    expect(list(`${MODEL}/sites`)).toEqual(SITES.map((slug) => `${slug}.json`));
    for (const slug of SITES) {
      const forecast = parseSiteForecastJson(read(`${MODEL}/sites/${slug}.json`));
      expect(forecast, slug).not.toBeNull();
      expect(forecast?.site.id).toBe(slug);
    }
  });

  it("each site carries one month archive whose lines and sidecar parse", () => {
    for (const slug of SITES) {
      const months = list(`${MODEL}/history/${slug}`);
      expect(months, slug).toHaveLength(2);
      const archiveName = months.find((name) => name.endsWith(".jsonl.gz"));
      const indexName = months.find((name) => name.endsWith(".index.json"));
      expect(archiveName, slug).toBeDefined();
      expect(indexName, slug).toBeDefined();

      const members = splitHistoryArchive(readBytes(`${MODEL}/history/${slug}/${archiveName}`));
      expect(members, slug).not.toBeNull();
      expect(members!.length).toBeGreaterThan(0);
      for (const member of members!) {
        for (const line of member.lines) {
          expect(parseSiteForecastJson(line), slug).not.toBeNull();
        }
      }

      const index = parseHistoryIndexJson(read(`${MODEL}/history/${slug}/${indexName}`));
      expect(index, slug).not.toBeNull();
      expect(
        index?.members.map(({ byteOffset, byteLength }) => ({ byteOffset, byteLength })),
      ).toEqual(members!.map(({ byteOffset, byteLength }) => ({ byteOffset, byteLength })));
    }
  });
});
