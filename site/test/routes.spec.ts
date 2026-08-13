import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sidebar } from "../src/lib/sidebar.mjs";
import { filesBelow, guardStaticBrowsing } from "./helpers";

/* These routes are derived from the content SOURCE — the docs sidebar
   astro.config.mjs builds with (src/lib/sidebar.mjs), and every logbook
   entry on disk — so a page silently dropped from the output fails here
   instead of simply never being visited. */

const logbookDirectory = fileURLToPath(new URL("../src/content/logbook/", import.meta.url));

function logbookRoutes(): string[] {
  return filesBelow(logbookDirectory)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => path.relative(logbookDirectory, file).replace(/\.mdx$/, "").replace(/\/index$/, ""))
    .sort()
    .map((slug) => `/logbook/${slug}/`);
}

type SidebarItem = { slug: string } | { label: string; items: SidebarItem[] };

function slugsOf(items: SidebarItem[]): string[] {
  return items.flatMap((item) => ("items" in item ? slugsOf(item.items) : [item.slug]));
}

function docsRoutes(): string[] {
  return sidebar.flatMap((group) => slugsOf(group.items).map((slug) => `/${slug}/`));
}

const expectedRoutes = [
  "/",
  ...docsRoutes(),
  "/station/",
  "/forecast/",
  "/briefing/",
  "/logbook/",
  ...logbookRoutes(),
  "/about/",
];

test.describe("every content-source route exists in the static build", () => {
  for (const route of expectedRoutes) {
    test(`${route} renders from the static build`, async ({ page, baseURL }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      const externalRequests = await guardStaticBrowsing(page, baseURL!);

      const response = await page.goto(route, { waitUntil: "networkidle" });

      expect(response, `${route} did not return a document response`).not.toBeNull();
      expect(response!.ok(), `${route} returned ${response!.status()}`).toBe(true);
      await expect(page.locator("main")).toBeVisible();
      expect(browserErrors).toEqual([]);
      expect(externalRequests, `${route} attempted external network access`).toEqual([]);
    });
  }
});
