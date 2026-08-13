import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

const INGESTED = /\/content\/docs\/docs\/(briefing|station|forecast|core|grib|j2k)\/(.+\.mdx?)$/;

/* GitHub's web UI does not traverse the committed content symlinks, so "Edit
   page" must point at each ingested page's real file at the repo root. */
export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const filePath = starlightRoute.entry.filePath ?? "";
  const match = INGESTED.exec(filePath);
  if (!match) return;
  starlightRoute.editUrl = new URL(
    `https://github.com/azohra/meteo/edit/main/${match[1]}/docs/${match[2]}`,
  );
});
