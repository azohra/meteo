import { expect, test } from "@playwright/test";
import { guardStaticBrowsing } from "./helpers";

/* The station exhibits are living components, not screenshots: these tests
   hold the docs component gallery (the full catalogue), the trimmed
   /station/ product page, and the homepage card to actually upgrading the
   <meteo-*> custom elements, rendering real content from the synthetic
   feed, responding to every control, and doing all of it without a single
   request leaving the preview origin. */

const GALLERY = "/docs/station/component-gallery/";

const SECTION_IDS = [
  "ways",
  "cards",
  "instruments",
  "charts",
  "roses",
  "seasons",
  "trends",
  "air",
  "table",
  "strips",
  "primitives",
  "explicit",
];

test.describe("the docs component gallery exhibits the custom-elements binding", () => {
  test("the elements upgrade and render the synthetic feed", async ({ page, baseURL }) => {
    const externalRequests = await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    // The flagship card renders its full default composition in light DOM;
    // the second card is authored composition — header, chart, summary.
    const card = page.locator("#cards meteo-station-card article.meteo-station-card").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "ok");
    await expect(card.locator(".meteo-station-card-name")).toHaveText("Launch Ridge");
    await expect(card.locator(".meteo-wind-dial")).toBeVisible();
    await expect(card.locator(".meteo-wind-chart-svg")).toBeVisible();
    const composed = page.locator("#cards meteo-station-card").nth(1);
    await expect(composed.locator(".meteo-station-card-name")).toHaveText("Summit Logger");
    await expect(composed.locator("meteo-station-card-chart .meteo-wind-chart-svg")).toBeVisible();
    await expect(composed.locator("meteo-station-card-summary")).toBeVisible();

    // Instruments: four shapes of truth, and the outage keeps its card.
    await expect(page.locator("#instruments meteo-current-conditions")).toHaveCount(2);
    await expect(
      page.locator("#instruments .meteo-current[data-status='unavailable']"),
    ).toBeVisible();

    // The bare dial is an SVG instrument, not an empty tag.
    await expect(page.locator("meteo-dial > svg.meteo-wind-dial").first()).toBeVisible();

    // Charts: graded and plain six-hour histories both draw.
    await expect(page.locator("#charts meteo-wind-history-chart .meteo-wind-chart-svg")).toHaveCount(
      3,
    );
    await expect(page.locator("meteo-daily-pattern .meteo-daily-pattern-svg")).toBeVisible();

    // "Two ways in": the headless object prints real numbers beside the rose.
    await expect(page.locator("#ways-output")).toContainText("sampleCount");
    await expect(page.locator("#ways-output")).toContainText("calmFraction");
    expect(await page.locator("#ways-rose .meteo-wind-rose-petal").count()).toBeGreaterThan(0);

    // The roses draw petals; the favorable ring rides Launch Ridge only.
    expect(await page.locator("#roses-ridge .meteo-wind-rose-petal").count()).toBeGreaterThan(0);
    expect(await page.locator("#season-rose .meteo-wind-rose-petal").count()).toBeGreaterThan(0);

    // Trends: temperature and pressure both draw for Launch Ridge.
    await expect(page.locator("#trends meteo-trend-chart .meteo-trend-svg")).toHaveCount(2);

    // Air: the matrix folds behind its trigger; expanded, only the
    // conditions-capable station earns a column.
    await expect(page.locator("meteo-air-matrix .meteo-air")).toBeVisible();
    await page.locator("meteo-air-matrix .meteo-air-trigger").click();
    const airTable = page.locator("meteo-air-matrix .meteo-air-matrix");
    await expect(airTable).toBeVisible();
    await expect(airTable).toContainText("Valley Tempest");
    await expect(airTable).not.toContainText("Summit Logger");

    // The fleet: four stations, and the outage keeps its row with a reason.
    await expect(page.locator("meteo-station-table [role='row'][data-status]")).toHaveCount(4);
    await expect(page.locator("meteo-station-table .meteo-station-table-reason")).not.toBeEmpty();
    await expect(page.locator(".station-strips meteo-station-strip")).toHaveCount(3);

    // Atoms print real readings — the wire value rides the <data> element.
    await expect(page.locator("meteo-speed data.meteo-value").first()).toHaveAttribute(
      "value",
      /\d/,
    );
    await expect(page.locator("meteo-pressure")).toContainText("hPa");
    await expect(page.locator("meteo-band-chip .meteo-band-chip").first()).toHaveAttribute(
      "data-band",
      /\d/,
    );

    // All three freshness states are presented.
    await expect(page.locator("meteo-freshness-badge .meteo-freshness")).toHaveCount(3);

    expect(externalRequests, "the gallery attempted external network access").toEqual([]);
  });

  test("the twelve registry sections all render, and the toolbar anchors them", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    for (const id of SECTION_IDS) {
      await expect(page.locator(`section#${id}`), `section #${id} exists`).toHaveCount(1);
    }
    const anchors = page.locator("#station-toolbar nav a");
    await expect(anchors).toHaveCount(SECTION_IDS.length);
    expect(await anchors.evaluateAll((links) => links.map((a) => a.getAttribute("href")))).toEqual(
      SECTION_IDS.map((id) => `#${id}`),
    );
  });

  test("the display-unit control converts every printed speed, provider or not", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    const speed = page.locator("meteo-speed data.meteo-value").first();
    const explicitDial = page.locator("#explicit-conditions .meteo-wind-dial");
    await expect(speed).toContainText("km/h");
    await expect(explicitDial).toContainText("km/h");
    await page.getByRole("button", { name: "kn", exact: true }).click();
    await expect(speed).toContainText("kn");
    await expect(speed).not.toContainText("km/h");
    // The provider-less instrument follows the same control.
    await expect(explicitDial).toContainText("kn");
    // The wire value is unchanged: the unit is display-only.
    await expect(speed).toHaveAttribute("value", /\d/);
  });

  test("the explicit-props section renders with no provider ancestor", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    const instrument = page.locator("#explicit-conditions .meteo-current");
    await expect(instrument).toBeVisible();
    await expect(instrument).toHaveAttribute("data-status", "ok");
    await expect(instrument.locator(".meteo-wind-dial")).toBeVisible();
    expect(
      await page
        .locator("#explicit-conditions")
        .evaluate((element) => element.closest("meteo-station-feed")),
    ).toBeNull();
  });

  test("the History Lab window control re-slices the same fetched points", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    const lab = page.locator("#history-lab");
    await expect(lab.locator(".meteo-wind-chart-svg")).toBeVisible();
    // Every render mints a fresh hatch-pattern id; normalize it so the
    // comparison sees the drawing, not the counter.
    const snapshot = async () => (await lab.innerHTML()).replace(/meteo-hatch-e\d+/g, "hatch");
    const sixHours = await snapshot();

    await page.getByRole("button", { name: "12 h", exact: true }).click();
    await expect(lab).toHaveAttribute("window-hours", "12");
    expect(await snapshot()).not.toBe(sixHours);

    await page.getByRole("button", { name: "24 h", exact: true }).click();
    await expect(lab).toHaveAttribute("window-hours", "24");

    // The compare overlay is one attribute; Off removes it.
    await page.getByRole("button", { name: "vs. -1 day", exact: true }).click();
    await expect(lab).toHaveAttribute("compare-offset-days", "1");
    await page.getByRole("button", { name: "Off", exact: true }).click();
    expect(await lab.getAttribute("compare-offset-days")).toBeNull();

    await page.getByRole("button", { name: "6 h", exact: true }).click();
    expect(await snapshot()).toBe(sixHours);
  });

  test("the season filter re-draws the rose from the same points", async ({ page, baseURL }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.goto(GALLERY, { waitUntil: "networkidle" });

    const rose = page.locator("#season-rose");
    const count = page.locator("#season-count");
    const all = await rose.innerHTML();
    const allCount = await count.textContent();

    // "Season" reveals the season picker (Winter is the default pick).
    await page.getByRole("button", { name: "Season", exact: true }).click();
    expect(await rose.innerHTML()).not.toBe(all);
    await page.getByRole("button", { name: "Summer", exact: true }).click();
    const summer = await rose.innerHTML();
    expect(summer).not.toBe(all);
    expect(await count.textContent()).not.toBe(allCount);

    // Time of day narrows through the SAME filter chain.
    await page.getByRole("button", { name: /Midday/ }).click();
    expect(await rose.innerHTML()).not.toBe(summer);

    await page.getByRole("button", { name: "All day", exact: true }).click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    expect(await rose.innerHTML()).toBe(all);
    expect(await count.textContent()).toBe(allCount);
  });
});

test.describe("/station/ carries the pitch on three live exhibits", () => {
  test("the hero, cards, charts, and roses render; the catalogue lives in the docs", async ({
    page,
    baseURL,
  }) => {
    const externalRequests = await guardStaticBrowsing(page, baseURL!);
    await page.goto("/station/", { waitUntil: "networkidle" });

    // The hero's wire demo prints the reading and draws the same object.
    await expect(page.locator("#station-wire-json")).toContainText("windAvgMps");
    await expect(page.locator("#station-hero-feed .meteo-current")).toBeVisible();

    // Exactly the three exhibits: cards, charts, roses — nothing else.
    for (const id of ["cards", "charts", "roses"]) {
      await expect(page.locator(`section#${id}`), `section #${id} exists`).toHaveCount(1);
    }
    for (const id of SECTION_IDS.filter((id) => !["cards", "charts", "roses"].includes(id))) {
      await expect(page.locator(`section#${id}`), `section #${id} moved to the docs`).toHaveCount(
        0,
      );
    }

    const card = page.locator("#cards meteo-station-card article.meteo-station-card").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "ok");
    await expect(card.locator(".meteo-station-card-name")).toHaveText("Launch Ridge");
    await expect(page.locator("#charts meteo-wind-history-chart .meteo-wind-chart-svg")).toHaveCount(
      3,
    );
    expect(await page.locator("#roses-ridge .meteo-wind-rose-petal").count()).toBeGreaterThan(0);

    // The History Lab controls still work on the product page.
    const lab = page.locator("#history-lab");
    await expect(lab.locator(".meteo-wind-chart-svg")).toBeVisible();
    await page.getByRole("button", { name: "12 h", exact: true }).click();
    await expect(lab).toHaveAttribute("window-hours", "12");

    // The page ends pointing at the full catalogue and the documentation.
    await expect(page.getByRole("link", { name: /component\s+gallery/i })).toHaveAttribute(
      "href",
      "/docs/station/component-gallery/",
    );
    await expect(page.getByRole("link", { name: "the station documentation" })).toHaveAttribute(
      "href",
      "/docs/station/",
    );

    expect(externalRequests, "/station/ attempted external network access").toEqual([]);
  });

  test("the site theme toggle pins the components' colour scheme both ways", async ({
    page,
    baseURL,
  }) => {
    await guardStaticBrowsing(page, baseURL!);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/station/", { waitUntil: "networkidle" });

    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /Colour theme/ });
    const card = page.locator("article.meteo-station-card").first();

    // System preference (light) is the default; the pin says so.
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(html).toHaveAttribute("data-theme-mode", "auto");
    const lightSurface = await card.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );

    // Auto → Light → Dark: the pin cascades into .meteo-root.
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme-mode", "light");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    const darkSurface = await card.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(darkSurface).not.toBe(lightSurface);

    // The choice persists across a navigation.
    await page.goto("/station/", { waitUntil: "networkidle" });
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(
      await page
        .locator("article.meteo-station-card")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(darkSurface);

    // Dark → Auto: back to the system preference.
    await page.getByRole("button", { name: /Colour theme/ }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(
      await page
        .locator("article.meteo-station-card")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(lightSurface);
  });
});

test("the homepage exhibits a live station card and links to the gallery", async ({
  page,
  baseURL,
}) => {
  const externalRequests = await guardStaticBrowsing(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });

  const section = page.locator("#station");
  await section.scrollIntoViewIfNeeded();
  const card = section.locator("article.meteo-station-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".meteo-station-card-name")).toHaveText("Launch Ridge");
  await expect(card.locator(".meteo-wind-chart-svg")).toBeVisible();
  await expect(section.getByRole("link", { name: /component gallery/i })).toHaveAttribute(
    "href",
    "/docs/station/component-gallery/",
  );
  expect(externalRequests, "the homepage attempted external network access").toEqual([]);
});
