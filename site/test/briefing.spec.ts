import { expect, test } from "@playwright/test";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatBytes } from "../src/lib/forecast-exhibit";
import { guardStaticBrowsing } from "./helpers";

/* The briefing page is the read side worked end to end over committed
   inputs. Data honesty — rendered numbers matching the packages' real
   output — is owned at build time by the exhibit modules' fail() guards
   (src/components/briefing/exhibit.ts); the prose is a human read. These
   tests hold only the page's structure and its two structural rulings: no
   second interactive layer-toggle exhibit (the homepage owns that), and a
   centred plate (the left-justified chart was the page's one filed bug). */

const archivePath = fileURLToPath(
  new URL(
    "../public/data-sample/hrdps-continental/history/test-hill/2026-08.jsonl.gz",
    import.meta.url,
  ),
);

test.describe("/briefing/ exhibits the read side end to end", () => {
  test("the hero renders the briefing card and routes into the tier docs", async ({
    page,
    baseURL,
  }) => {
    const externalRequests = await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    await expect(page.locator("h1")).toBeVisible();

    // The card renders pilot-readable lines — no raw JSON in the hero.
    const panel = page.locator("#briefing-finding");
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText('"kind"');

    // The documentation rail routes into the tier docs.
    const docrail = page.locator(".bf-docrail");
    for (const slug of ["analyze", "compare", "history", "contract", "reading-a-meteogram"]) {
      await expect(docrail.locator(`a[href="/docs/briefing/${slug}/"]`)).toHaveCount(1);
    }

    expect(externalRequests, "/briefing/ attempted external network access").toEqual([]);
  });

  test("the findings exhibit renders one row per finding", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    // Eight findings, eight rows — the profile emits thermalWindow,
    // liftCeiling, windSummary, two windExceedances, windDirection,
    // bandShear, and dataCaveats.
    const findings = page.locator(".bf-finding-rows");
    await expect(findings.locator("dt")).toHaveCount(8);
  });

  test("the comparison renders both members as real plates", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    // Both members render as real plates from their own documents.
    const figure = page.locator("#briefing-compare-plates");
    await expect(figure.locator(".bf-compare-panel svg.meteo-gram")).toHaveCount(2);
  });

  test("the history exhibit reads the sample archive's own bytes", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    const archive = page.locator("#briefing-archive");
    // The panel's size is the committed file's size, via the same
    // formatter — the exhibit cannot drift from disk.
    await expect(archive).toContainText(
      `history/test-hill/2026-08.jsonl.gz · ${formatBytes(statSync(archivePath).size)}`,
    );
  });

  test("the meteogram tier draws the analyzed day once, as a static plate", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    // One plate, rendered from the same profile the findings read.
    const figure = page.locator("#briefing-meteogram-figure");
    const chart = figure.locator("[data-synthetic-meteogram] svg.meteo-gram");
    await expect(chart).toBeVisible();
    await expect(figure.locator(".meteo-gram-launch-line")).toHaveCount(1);
    await expect(figure.locator("[data-meteogram-key] svg")).toBeVisible();

    // Static means static: no layer-toggle exhibit anywhere on this page
    // (the homepage owns that), so no overlay controls and no embedded
    // profile documents.
    await expect(page.locator("input[data-meteogram-overlay]")).toHaveCount(0);
    await expect(page.locator("[data-meteogram-source]")).toHaveCount(0);
  });

  test("the plate and its chart sit centred, not left-justified", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    const gutters = async (outerSelector: string, innerSelector: string) => {
      const outer = await page.locator(outerSelector).boundingBox();
      const inner = await page.locator(innerSelector).boundingBox();
      if (!outer || !inner) throw new Error(`${outerSelector} / ${innerSelector} did not lay out`);
      return {
        left: inner.x - outer.x,
        right: outer.x + outer.width - (inner.x + inner.width),
      };
    };

    // The figure frame centres on the section column…
    const frame = await gutters(".bf-plate-inner", "#briefing-meteogram-figure");
    expect(Math.abs(frame.left - frame.right)).toBeLessThanOrEqual(2);

    // …and the SVG centres inside the frame instead of hugging its left
    // edge (the filed bug: a chart narrower than its mount sat at x=0).
    const chart = await gutters(
      "#briefing-meteogram-figure .synthetic-meteogram__mount",
      "#briefing-meteogram-figure .synthetic-meteogram__mount > svg.meteo-gram",
    );
    expect(chart.left).toBeGreaterThan(8);
    expect(Math.abs(chart.left - chart.right)).toBeLessThanOrEqual(2);
  });

  test("the start-building section and boundary hold their structure", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto("/briefing/", { waitUntil: "networkidle" });

    // Install fence + the runnable read fence, and a docs pointer.
    const surfaces = page.locator(".bf-surfaces");
    await expect(surfaces.locator(".bf-code")).toHaveCount(2);
    await expect(surfaces.locator('a[href="/docs/briefing/"]')).toHaveCount(1);

    // The boundary routes to the producing side and the reference docs.
    const boundary = page.locator("#boundary");
    await expect(boundary.locator('a[href="/forecast/"]')).toHaveCount(1);
    await expect(boundary.locator('a[href="/docs/briefing/"]')).toHaveCount(1);
  });
});
