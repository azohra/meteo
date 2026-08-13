import {
  modelCatalogueSchema,
  type ModelCatalogue,
  type ModelEntry,
  type ObservationModelEntry,
  type SmokeModelEntry,
} from "@azohra/meteo.briefing/contract";
import rawCatalogue from "../../../forecast/models.json";

const catalogue: ModelCatalogue = modelCatalogueSchema.parse(rawCatalogue);

export const MODELS: ModelEntry[] = catalogue.models;
export const SMOKE_MODELS: SmokeModelEntry[] = catalogue.smokeModels ?? [];
export const OBSERVATION_MODELS: ObservationModelEntry[] = catalogue.observationModels ?? [];

export function modelBySlug(slug: string): ModelEntry | undefined {
  return MODELS.find((model) => model.slug === slug);
}

export function omegaLevels(slug: string): number[] {
  return modelBySlug(slug)?.capabilities.verticalVelocityLevels ?? [];
}

export function runIntervalHours(slug: string): number {
  return modelBySlug(slug)?.runIntervalHours ?? 12;
}
