import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderJsonArtifact, renderSchemaArtifact } from "@azohra/meteo.core";
import { parseStationFeed } from "../src/contract.js";
import { exampleArtifacts, schemaArtifacts } from "../src/internal/schema-artifacts.js";

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema");

const committed = (fileName: string): string =>
  readFileSync(path.join(schemaDir, fileName), "utf8");

describe("schema/ drift", () => {
  for (const artifact of schemaArtifacts) {
    it(`schema/${artifact.fileName} matches a regeneration from the live contract byte for byte`, () => {
      expect(committed(artifact.fileName)).toBe(renderSchemaArtifact(artifact));
    });
  }

  for (const example of exampleArtifacts) {
    it(`schema/${example.fileName} matches its source byte for byte and validates against the wire contract`, () => {
      expect(committed(example.fileName)).toBe(renderJsonArtifact(example.document));
      expect(() => example.schema.parse(example.document)).not.toThrow();
    });
  }
});

describe("wire contract evolution", () => {
  it("parsing strips unknown keys rather than rejecting them — additive fields must never require a schema switch to strict", () => {
    const feedExample = exampleArtifacts.find(
      (example) => example.fileName === "example-feed.json",
    );
    const document = JSON.parse(JSON.stringify(feedExample?.document)) as Record<string, unknown>;
    document.futureAdditiveField = { anything: true };
    const parsed = parseStationFeed(document);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("futureAdditiveField");
  });

  it("a document published before the additive meta and point fields still parses", () => {
    const feedExample = exampleArtifacts.find(
      (example) => example.fileName === "example-feed.json",
    );
    const document = JSON.parse(JSON.stringify(feedExample?.document)) as {
      stations: Array<Record<string, unknown>>;
    };
    for (const station of document.stations) {
      delete station.declaredFavorableDirections;
      delete station.broadcastDelaySeconds;
      const history = station.history as { points?: Array<Record<string, unknown>> } | null;
      for (const point of history?.points ?? []) {
        delete point.windVectorAvgMps;
        delete point.temperatureMinC;
        delete point.temperatureMaxC;
        delete point.seaLevelPressureMinHpa;
        delete point.seaLevelPressureMaxHpa;
      }
    }
    expect(parseStationFeed(document)).not.toBeNull();
  });

  it("declaredFavorableDirections keeps [] and null apart — explicitly none vs nothing knowable", () => {
    const feedExample = exampleArtifacts.find(
      (example) => example.fileName === "example-feed.json",
    );
    const document = JSON.parse(JSON.stringify(feedExample?.document)) as {
      stations: Array<Record<string, unknown>>;
    };
    (document.stations[0] as Record<string, unknown>).declaredFavorableDirections = [];
    (document.stations[1] as Record<string, unknown>).declaredFavorableDirections = null;
    const parsed = parseStationFeed(document);
    expect(parsed?.stations[0]?.declaredFavorableDirections).toEqual([]);
    expect(parsed?.stations[1]?.declaredFavorableDirections).toBeNull();
  });
});
