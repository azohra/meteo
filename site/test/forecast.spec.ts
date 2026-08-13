import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatBytes } from "../src/lib/forecast-exhibit";
import { filesBelow, guardStaticBrowsing } from "./helpers";

/* /forecast/ exhibits the engine through its committed output: these
   tests hold the page to the sample dataset itself. Every number, size,
   and JSON line shown must be the one in site/public/data-sample right
   now — regenerating the sample must never strand the page — and the
   whole visit must stay on the preview origin. */

const sampleRoot = fileURLToPath(new URL("../public/data-sample/", import.meta.url));

function sampleJson(relative: string): any {
  return JSON.parse(readFileSync(path.join(sampleRoot, relative), "utf8"));
}

test.describe("/forecast/ exhibits the engine's committed output", () => {
  test("the page renders hermetically, with the sample's own numbers", async ({
    page,
    baseURL,
  }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    const externalRequests = await guardStaticBrowsing(page, baseURL!);
    await page.goto("/forecast/", { waitUntil: "networkidle" });

    // The hero prints runs.json whole: the newest run's referenceTime is
    // the committed one.
    const runs = sampleJson("runs.json");
    await expect(page.locator("#runs-json")).toContainText(
      runs.runs["hrdps-continental"].referenceTime,
    );

    // The excerpt is parsed from test-hill.json: the opened hour is the
    // last one in the file, its derived block shown value for value.
    const testHill = sampleJson("hrdps-continental/sites/test-hill.json");
    const lastHour = testHill.hours[testHill.hours.length - 1];
    const excerpt = page.locator("#site-document-excerpt");
    await expect(excerpt).toContainText(`"validAt": "${lastHour.validAt}"`);
    for (const [name, value] of Object.entries(lastHour.derived)) {
      await expect(excerpt).toContainText(`"${name}": ${value ?? "null"}`);
    }
    await expect(excerpt).toContainText(`"referenceTime": "${testHill.run.referenceTime}"`);
    await expect(excerpt).toContainText(`${testHill.hours.length - 1} earlier hours`);

    // The cost line restates manifest.stats, not remembered numbers.
    const manifest = sampleJson("hrdps-continental/manifest.json");
    const cost = page.locator("#dataset-cost");
    await expect(cost).toContainText(`${manifest.stats.downloads} provider downloads`);
    await expect(cost).toContainText(`${formatBytes(manifest.stats.downloadBytes)} fetched`);
    await expect(cost).toContainText(`${manifest.stats.retries} retries`);

    expect(browserErrors).toEqual([]);
    expect(externalRequests, "/forecast/ attempted external network access").toEqual([]);
  });

  test("the tree lists every committed document with its measured size", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/forecast/", { waitUntil: "networkidle" });

    // Derived from the dataset SOURCE: every file on disk (the README
    // aside) must have a row, and no row may point at a missing file.
    const committed = filesBelow(sampleRoot)
      .map((file) => path.relative(sampleRoot, file))
      .filter((relative) => relative !== "README.md")
      .sort();
    const rows = page.locator(".fc-tree-row[data-path]");
    const shown = (await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-path")),
    )).sort();
    expect(shown).toEqual(committed);

    for (const relative of committed) {
      const row = page.locator(`.fc-tree-row[data-path="${relative}"]`);
      await expect(row.locator(".fc-tree-size")).toHaveText(
        formatBytes(statSync(path.join(sampleRoot, relative)).size),
      );
    }
  });

  test("both committed diagrams are inlined into the static build", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/forecast/", { waitUntil: "networkidle" });

    // Inlined as real <svg> elements — not <img> — so the plates' chrome
    // var(--meteo-gram-*) tokens resolve against the page theme.
    await expect(page.locator("#flow img")).toHaveCount(0);
    const figures = page.locator("#flow .fc-figure > svg");
    await expect(figures).toHaveCount(2);
    for (const figure of await figures.all()) {
      await expect(figure).toHaveAttribute("role", "img");
      await expect(figure).toHaveAttribute("aria-label", /.{20,}/);
      expect(
        await figure.evaluate(
          (element) => element.querySelectorAll('[fill^="var(--meteo-gram-"]').length,
        ),
      ).toBeGreaterThan(0);
      const box = await figure.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
    }
  });

  test("the page links out to the documentation that carries the detail", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/forecast/", { waitUntil: "networkidle" });

    // The docrail mirrors the sidebar's five forecast reference pages.
    const docrail = page.locator(".fc-docrail a");
    expect(
      await docrail.evaluateAll((links) => links.map((a) => a.getAttribute("href"))),
    ).toEqual([
      "/docs/forecast/architecture/",
      "/docs/forecast/derivation-science/",
      "/docs/forecast/builder-contract/",
      "/docs/forecast/provider-transports/",
      "/docs/forecast/adding-a-model/",
    ]);

    // The boundary paragraph hands off to the operator path and the index.
    const boundary = page.locator("#boundary");
    await expect(boundary.locator('a[href="/docs/publish/run-one-model/"]')).toBeVisible();
    await expect(boundary.locator('a[href="/docs/forecast/"]')).toBeVisible();
  });
});
