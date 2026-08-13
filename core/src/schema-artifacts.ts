import { z, type ZodType } from "zod";

export interface SchemaArtifact {
  fileName: string;
  title: string;
  schema: ZodType;
  description?: string;
}

/** An example wire document committed beside the schemas, validated against its schema before writing. */
export interface ExampleArtifact {
  fileName: string;
  document: unknown;
  schema: ZodType;
}

/** The artifact's JSON Schema document, exactly as shipped. */
export function schemaArtifactJson(artifact: SchemaArtifact): Record<string, unknown> {
  // io: "input": wire readers ignore unknown keys, so a published schema must not carry additionalProperties: false.
  const generated = z.toJSONSchema(artifact.schema, { target: "draft-2020-12", io: "input" });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://meteo.azohra.com/schema/${artifact.fileName}`,
    title: artifact.title,
    ...(artifact.description === undefined ? {} : { description: artifact.description }),
    ...generated,
  };
}

/** The exact shipped bytes of any schema/ JSON artifact. */
export function renderJsonArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderSchemaArtifact(artifact: SchemaArtifact): string {
  return renderJsonArtifact(schemaArtifactJson(artifact));
}
