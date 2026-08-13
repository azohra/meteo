import type { Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";

/* One home for the plumbing the suites share: a recursive file walk and
   the hermetic-browsing guard that keeps tests off the network. */

export function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

/** Abort and record any request leaving the preview origin: the site must
    browse as a purely static artifact. Returns the (ideally empty) log. */
export async function guardStaticBrowsing(page: Page, baseURL: string): Promise<string[]> {
  const origin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return externalRequests;
}
