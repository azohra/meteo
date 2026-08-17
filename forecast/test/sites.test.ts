import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSites, type Site } from "../src/sites.js";

const SITE: Site = {
  slug: "dundee",
  name: "Dundee",
  latitude: 49.291977,
  longitude: -117.183569,
  timeZone: "America/Vancouver",
};

function catalogue(sites: unknown[], version = 2): string {
  return JSON.stringify({ schemaVersion: version, sites });
}

describe("parseSites", () => {
  it("loads the sites out of the versioned envelope", () => {
    expect(parseSites(catalogue([SITE]))).toEqual([SITE]);
  });

  it("accepts an already-parsed document too", () => {
    expect(parseSites({ schemaVersion: 2, sites: [SITE] })).toEqual([SITE]);
  });

  it("rejects a schema version this pipeline does not speak", () => {
    expect(() => parseSites(catalogue([SITE], 1))).toThrowError(/schemaVersion/);
  });

  it("rejects the old bare-array shape", () => {
    expect(() => parseSites(JSON.stringify([SITE]))).toThrowError(/schemaVersion/);
  });

  it("rejects an empty catalogue", () => {
    expect(() => parseSites(catalogue([]))).toThrowError(/no sites/);
  });

  it("rejects a typed-in elevation and points at the context", () => {
    // An elevationM in the catalogue means someone hasn't absorbed the
    // launch decoupling: the message must direct them to the measured home,
    // not merely reject the field.
    const failing = () => parseSites(catalogue([{ ...SITE, elevationM: 1485 }]));
    expect(failing).toThrowError(/site-context\.json/);
    expect(failing).toThrowError(/meteo forecast terrain/);
    expect(failing).toThrowError(/'dundee'/);
  });

  it("rejects a site missing identity fields", () => {
    const { timeZone: _timeZone, ...incomplete } = SITE;
    expect(() => parseSites(catalogue([incomplete]))).toThrowError(/missing timeZone/);
  });

  it("rejects fields outside the identity vocabulary", () => {
    expect(() =>
      parseSites(catalogue([{ ...SITE, what3words: "filled.count.soap" }])),
    ).toThrowError(/unknown fields what3words/);
  });

  it("field semantics are the reader contract's — a value sitesCatalogueSchema refuses fails here too", () => {
    expect(() => parseSites(catalogue([{ ...SITE, slug: "Not A Slug" }]))).toThrowError(
      /sites catalogue contract/,
    );
    expect(() => parseSites(catalogue([{ ...SITE, timeZone: "" }]))).toThrowError(
      /sites catalogue contract/,
    );
  });

  it("the repository catalogue loads with every field a builder samples", () => {
    const path = join(__dirname, "..", "..", "scenarios", "catalog", "sites.json");
    const sites = parseSites(readFileSync(path, "utf-8"), path);

    expect(sites.length, "the repository catalogue must list at least one site").toBeGreaterThan(0);
    for (const site of sites) {
      expect(new Set(Object.keys(site))).toEqual(
        new Set(["slug", "name", "latitude", "longitude", "timeZone"]),
      );
    }
  });
});
