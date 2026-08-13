import { expect, test } from "@playwright/test";
import { guardStaticBrowsing } from "./helpers";

/* The homepage's copy is a human read; these tests hold its structure:
   the hero exhibits a rendered Meteogram and a live upgraded station
   instrument (never screenshots), the platform-path diagram is drawn
   once, the explore bar mirrors the section set, and each layer section
   renders its exhibit. */

test("the hero exhibits both surfaces for real", async ({ page, baseURL }) => {
  const externalRequests = await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  const hero = page.locator(".home-hero");
  await expect(hero.locator("#home-title")).toBeVisible();

  // Rendered, not pictured: the Meteogram plate is package-rendered SVG and
  // the station plate is the live custom element, upgraded and drawing.
  await expect(hero.locator(".hero-plate__meteogram svg")).toBeVisible();
  await expect(hero.locator("meteo-current-conditions .meteo-wind-dial")).toBeVisible();

  expect(externalRequests, "the homepage attempted external network access").toEqual([]);
});

test("the platform path is drawn and the explore bar carries the section set", async ({
  page,
  baseURL,
}) => {
  await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  // One diagram, rendered as a real SVG.
  const path = page.locator("#path");
  await expect(path.locator("svg[role='img']")).toBeVisible();

  // The explore bar carries one link per section.
  const explore = page.locator(".home-index");
  await expect(explore.locator("ol a")).toHaveCount(5);
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
