import {
  siteContextSchema,
  sitesCatalogueSchema,
  type LandCoverClass,
  type SiteCatalogueEntry,
  type SiteContext,
  type SiteContextEntry,
  type SiteContextSource,
} from "@azohra/meteo.briefing/contract";
import rawContext from "../../../scenarios/catalog/site-context.json";
import rawSites from "../../../scenarios/catalog/sites.json";

const context: SiteContext = siteContextSchema.parse(rawContext);
const catalogue = sitesCatalogueSchema.parse(rawSites);

export const SITE_CONTEXT: SiteContext = context;

export interface ContextSite {
  site: SiteCatalogueEntry;
  context: SiteContextEntry;
}

export const CONTEXT_SITES: ContextSite[] = catalogue.sites.map((site) => {
  const entry = context.sites[site.slug];
  if (!entry) throw new Error(`site-context.json has no entry for catalogued site "${site.slug}"`);
  return { site, context: entry };
});

export function sourceById(id: string): SiteContextSource {
  const source = context.sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`site-context.json declares no source "${id}"`);
  return source;
}

export const LAND_COVER_LABELS: Record<LandCoverClass, string> = {
  treeCover: "tree cover",
  shrubland: "shrubland",
  grassland: "grassland",
  cropland: "cropland",
  builtUp: "built-up",
  bareSparse: "bare / sparse",
  snowIce: "snow / ice",
  water: "water",
  wetland: "wetland",
  mangroves: "mangroves",
  mossLichen: "moss / lichen",
};

export const LAND_COVER_COLORS: Record<LandCoverClass, string> = {
  treeCover: "#16694f",
  shrubland: "#7c6a1e",
  grassland: "#9a7500",
  cropland: "#b3891f",
  builtUp: "#8f302a",
  bareSparse: "#99795c",
  snowIce: "#8fa7b5",
  water: "#1f5f9b",
  wetland: "#207a83",
  mangroves: "#0f5747",
  mossLichen: "#6b7f4a",
};

export const LAND_COVER_ORDER: LandCoverClass[] = [
  "treeCover",
  "shrubland",
  "grassland",
  "cropland",
  "builtUp",
  "bareSparse",
  "snowIce",
  "water",
  "wetland",
  "mangroves",
  "mossLichen",
];
