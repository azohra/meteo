import {
  siteCatalogueEntrySchema,
  SITES_SCHEMA_VERSION,
  sitesCatalogueSchema,
  type SiteCatalogueEntry,
} from "@azohra/meteo.briefing/contract";

export { SITES_SCHEMA_VERSION };

export const SITE_FIELDS = siteCatalogueEntrySchema.keyof().options;

/** One catalogued site: identity and build selection, nothing measured. */
export type Site = SiteCatalogueEntry;

/**
 * Parses the catalogue's sites out of the versioned envelope; accepts raw
 * JSON text or an already-parsed document, with `source` naming the
 * catalogue in error messages.
 *
 * Shape and field semantics are the reader contract's
 * (`sitesCatalogueSchema`). This writer-side parser additionally rejects
 * unknown fields and `elevationM`, which the reader would merely strip,
 * so a mistyped catalogue entry fails instead of being silently ignored.
 */
export function parseSites(input: string | unknown, source = "sites.json"): Site[] {
  const document: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const version =
    typeof document === "object" && document !== null && !Array.isArray(document)
      ? (document as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version !== SITES_SCHEMA_VERSION) {
    throw new Error(
      `${source} declares schemaVersion ${String(version)}; ` +
        `this pipeline reads version ${SITES_SCHEMA_VERSION}`,
    );
  }
  const rawSites = (document as { sites?: unknown[] }).sites;
  if (!rawSites || rawSites.length === 0) {
    throw new Error(`${source} lists no sites`);
  }
  for (const site of rawSites) {
    requireIdentityOnly(site as Record<string, unknown>, source);
  }
  const parsed = sitesCatalogueSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${source} fails the sites catalogue contract at ${issue.path.join(".")}: ${issue.message}`,
    );
  }
  return parsed.data.sites;
}

function requireIdentityOnly(site: Record<string, unknown>, source: string): void {
  const label = `${source} site '${String(site.slug ?? "<unnamed>")}'`;
  if ("elevationM" in site) {
    throw new Error(
      `${label} carries elevationM — the catalogue has been identity-only ` +
        "since schemaVersion 2: the pipeline measures elevation into " +
        "site-context.json (`meteo forecast terrain`). Delete the field and " +
        "regenerate the context instead of typing an elevation here.",
    );
  }
  const missing = SITE_FIELDS.filter((field) => !(field in site));
  if (missing.length > 0) {
    throw new Error(`${label} is missing ${missing.join(", ")}`);
  }
  const unknown = Object.keys(site)
    .filter((field) => !(SITE_FIELDS as readonly string[]).includes(field))
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `${label} carries unknown fields ${unknown.join(", ")} — the ` +
        "catalogue is identity and build selection only",
    );
  }
}
