import { parseSiteContextJson, parseSitesCatalogueJson } from "@azohra/meteo.briefing/contract";
import { documentPaths } from "@azohra/meteo.briefing/transport";
import { fetchPublished, type DatasetOptions } from "./dataset.js";

/* Whether the published site-context still describes the published
   catalogue. Fresh means every catalogued site has a context entry whose
   measured point equals the catalogue's exactly (the echo is written
   verbatim, so the comparison is exact equality). Stale covers every
   condition regeneration cures: a missing context, an entry the catalogue
   gained, a moved point, and a v2 context, whose entries carry no point.
   A missing or unreadable catalogue throws rather than returning a
   verdict. */
export async function publishedContextFresh(options: DatasetOptions = {}): Promise<boolean> {
  const decoder = new TextDecoder();
  const sitesBytes = await fetchPublished(documentPaths.sites(), options);
  if (sitesBytes === null) {
    throw new Error("no sites.json is published — there is no catalogue to measure against");
  }
  const catalogue = parseSitesCatalogueJson(decoder.decode(sitesBytes));
  if (catalogue === null) {
    throw new Error("the published sites.json fails the contract guard");
  }
  const contextBytes = await fetchPublished(documentPaths.siteContext(), options);
  if (contextBytes === null) return false;
  const context = parseSiteContextJson(decoder.decode(contextBytes));
  if (context === null) return false;
  return catalogue.sites.every((site) => {
    const point = context.sites[site.slug]?.point;
    return (
      point !== undefined && point.latitude === site.latitude && point.longitude === site.longitude
    );
  });
}
