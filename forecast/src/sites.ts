export const SITES_SCHEMA_VERSION = 2;

export const SITE_FIELDS = ["slug", "name", "latitude", "longitude", "timeZone"] as const;

/** One catalogued site: identity and build selection, nothing measured. */
export interface Site {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

/**
 * Parses the catalogue's sites out of the versioned envelope; accepts raw
 * JSON text or an already-parsed document, with `source` naming the
 * catalogue in error messages.
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
  const sites = (document as { sites: Site[] }).sites;
  if (!sites || sites.length === 0) {
    throw new Error(`${source} lists no sites`);
  }
  for (const site of sites) {
    requireIdentityOnly(site as unknown as Record<string, unknown>, source);
  }
  return sites;
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
