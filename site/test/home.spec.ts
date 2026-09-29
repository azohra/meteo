import { expect, test } from "@playwright/test";
import { guardStaticBrowsing } from "./helpers";

/* The homepage's copy is a human read; these tests hold its structure:
   the hero draws the day arc from the scenario and a live upgraded
   station instrument (never screenshots), the platform-path diagram is
   drawn once, and each layer section renders its exhibit. */

test("the hero exhibits both surfaces for real", async ({ page, baseURL }) => {
  const externalRequests = await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  const hero = page.locator(".home-hero");
  await expect(hero.locator("#home-title")).toBeVisible();

  // Rendered, not pictured: the day arc is drawn from the scenario's
  // published heights, and the station is the live custom element.
  await expect(hero.locator(".day-arc [role='img'] svg:visible")).toHaveCount(1);
  await expect(hero.locator(".day-arc__lift").first()).toBeAttached();
  await expect(hero.locator("meteo-current-conditions .meteo-wind-dial")).toBeVisible();

  expect(externalRequests, "the homepage attempted external network access").toEqual([]);
});

test("the platform path is drawn", async ({
  page,
  baseURL,
}) => {
  await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  // One diagram, rendered as a real SVG.
  const path = page.locator("#path");
  await expect(path.locator("svg[role='img']")).toBeVisible();
});

test("the briefing and data sections render their exhibits", async ({ page, baseURL }) => {
  await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  // The briefing section carries the Meteogram as its visual tier.
  const briefing = page.locator("#briefing");
  await expect(briefing.locator(".synthetic-meteogram svg").first()).toBeVisible();

  // The data section carries its reference links.
  const data = page.locator("#data");
  await expect(data.locator(".home-data__refs a")).toHaveCount(4);
});
