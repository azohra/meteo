// The one home for which zod schemas ship as schema/*.json: the repo-root
// emitter writes exactly this table, and contract.test.ts asserts the
// shipped files match it byte for byte.
import type { SchemaArtifact } from "@azohra/meteo.core";
import {
  modelCatalogueSchema,
  observationDocumentSchema,
  runsIndexSchema,
  siteContextSchema,
  sitesCatalogueSchema,
  smokeDocumentSchema,
  manifestSchema,
  siteForecastSchema,
} from "../contract.js";

export const schemaArtifacts: readonly SchemaArtifact[] = [
  {
    fileName: "profile.schema.json",
    title: "meteo by Azohra site-forecast document",
    schema: siteForecastSchema,
  },
  {
    fileName: "smoke.schema.json",
    title: "meteo by Azohra smoke document",
    schema: smokeDocumentSchema,
  },
  {
    fileName: "observation.schema.json",
    title: "meteo by Azohra observation document",
    schema: observationDocumentSchema,
  },
  {
    fileName: "manifest.schema.json",
    title: "meteo by Azohra model manifest",
    schema: manifestSchema,
  },
  {
    fileName: "models.schema.json",
    title: "meteo by Azohra model catalogue, models.json",
    schema: modelCatalogueSchema,
  },
  {
    fileName: "sites.schema.json",
    title: "meteo by Azohra site catalogue, sites.json",
    schema: sitesCatalogueSchema,
  },
  {
    fileName: "site-context.schema.json",
    title: "meteo by Azohra site context, site-context.json",
    schema: siteContextSchema,
  },
  {
    fileName: "runs.schema.json",
    title: "meteo by Azohra cross-model run index, runs.json",
    schema: runsIndexSchema,
  },
];
