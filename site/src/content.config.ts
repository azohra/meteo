import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const requiredText = z.string().trim().min(1);

const logbookThumbnailKinds = [
  "lift-limits",
  "validation-witnesses",
  "ensemble-ceiling",
  "stability-contrast",
  "model-succession",
  "cloud-base-delta",
  "terrain-shear",
  "terrain-smoothing",
  "smoke-derate",
] as const;

const logbookSchema = z
  .object({
    title: requiredText,
    summary: requiredText,
    section: requiredText,
    kind: z.enum(["method", "experiment", "case-study"]),
    published: z.coerce.date(),
    updated: z.coerce.date(),
    status: z.enum(["current", "historical"]),
    order: z.number().int().nonnegative(),
    scenarios: z.array(requiredText),
    thumbnail: z.enum(logbookThumbnailKinds),
  })
  .strict()
  .refine(({ published, updated }) => updated >= published, {
    message: "updated must be on or after published",
    path: ["updated"],
  });

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
});

const logbook = defineCollection({
  loader: glob({
    base: "./src/content/logbook",
    pattern: "**/[^_]*.{md,mdx}",
  }),
  schema: logbookSchema,
});

export const collections = { docs, logbook };
