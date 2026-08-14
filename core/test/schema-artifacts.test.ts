import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  renderJsonArtifact,
  renderSchemaArtifact,
  schemaArtifactJson,
} from "../src/schema-artifacts.js";

const artifact = {
  fileName: "example.schema.json",
  title: "Example",
  schema: z.object({ name: z.string(), count: z.number().int() }),
};

describe("schemaArtifactJson", () => {
  it("stamps the platform $id and $schema around the generated document", () => {
    const document = schemaArtifactJson(artifact);
    expect(document["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(document["$id"]).toBe("https://meteo.azohra.com/schema/example.schema.json");
    expect(document["title"]).toBe("Example");
    expect(document).not.toHaveProperty("description");
    expect(schemaArtifactJson({ ...artifact, description: "why" })["description"]).toBe("why");
  });

  it("never closes a published schema — wire readers ignore unknown keys", () => {
    const closed: unknown[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) for (const item of node) walk(item);
      else if (node !== null && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (record["additionalProperties"] === false) closed.push(node);
        for (const value of Object.values(record)) walk(value);
      }
    };
    walk(schemaArtifactJson(artifact));
    expect(closed).toEqual([]);
  });
});

describe("renderJsonArtifact / renderSchemaArtifact", () => {
  it("ships two-space indentation with a trailing newline", () => {
    expect(renderJsonArtifact({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it("renders bytes that parse back to the artifact document", () => {
    const bytes = renderSchemaArtifact(artifact);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(JSON.parse(bytes)).toEqual(schemaArtifactJson(artifact));
  });
});
