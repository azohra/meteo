import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path to the model catalogue this package ships (models.json at the package root). */
export function packagedModelsPath(): string {
  return fileURLToPath(new URL("../models.json", import.meta.url));
}

/** Every published dataset slug the catalogue declares: profile, smoke, and observation models. */
export function cataloguedModelSlugs(modelsPath = packagedModelsPath()): string[] {
  const catalogue = JSON.parse(readFileSync(modelsPath, "utf-8")) as Record<
    string,
    Array<{ slug: string }> | undefined
  >;
  const slugs: string[] = [];
  for (const key of ["models", "smokeModels", "observationModels"]) {
    for (const entry of catalogue[key] ?? []) {
      slugs.push(entry.slug);
    }
  }
  return slugs;
}

/** The catalogue's kind declaration for a slug — "deterministic" or "ensemble" for forecast models; observation datasets declare none. */
export function cataloguedModelKind(
  slug: string,
  modelsPath = packagedModelsPath(),
): string | undefined {
  const catalogue = JSON.parse(readFileSync(modelsPath, "utf-8")) as Record<
    string,
    Array<{ slug: string; kind?: string }> | undefined
  >;
  for (const key of ["models", "smokeModels", "observationModels"]) {
    for (const entry of catalogue[key] ?? []) {
      if (entry.slug === slug) {
        return entry.kind;
      }
    }
  }
  return undefined;
}
