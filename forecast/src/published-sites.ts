import { documentPaths } from "@azohra/meteo.briefing/transport";
import { PublisherConfigurationError } from "./config.js";
import { fetchPublished, type DatasetOptions } from "./dataset.js";
import { parseSites, type Site } from "./sites.js";

/**
 * The launch catalogue read from the dataset itself: the deployment owner
 * publishes sites.json to the root, and builders passing `--sites dataset`
 * build from it instead of a catalogue kept in the operator's repository.
 * Parsed with the engine's writer-strict parser, same as a local file.
 */
export async function publishedSites(options: DatasetOptions = {}): Promise<Site[]> {
  const bytes = await fetchPublished(documentPaths.sites(), options);
  if (bytes === null) {
    throw new PublisherConfigurationError(
      "no sites.json is published at the dataset root — publish the site " +
        "catalogue before building from it, or pass --sites PATH",
    );
  }
  return parseSites(new TextDecoder().decode(bytes), "published sites.json");
}
