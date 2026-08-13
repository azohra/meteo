import { expect, test, type Locator } from "@playwright/test";
import { DEFAULT_OVERLAYS, TOKEN_DEFAULTS } from "@azohra/meteo.briefing/meteogram";

/** The package token hex as the browser reports computed colours. */
function cssRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const keySeriesClasses = [
  "meteo-gram-series-usable",
  "meteo-gram-series-cloud-base",
  "meteo-gram-series-boundary",
  "meteo-gram-series-pbl",
  "meteo-gram-isotherm-freezing",
] as const;

async function expectKeyMatchesChart(chart: Locator, key: Locator) {
  for (const className of keySeriesClasses) {
    const chartCount = await chart.locator(`.${className}`).count();
    const keyCount = await key.locator(`.${className}`).count();
    expect(keyCount, `${className} key parity`).toBe(chartCount > 0 ? 1 : 0);
  }

  const chartHasDenseCloud = (await chart.locator(".meteo-gram-cloud-dense").count()) > 0;
  const keyHasDenseCloud = (await key.locator('[id$="-cloud-hatch"]').count()) > 0;
  expect(keyHasDenseCloud, "condensation hatch key parity").toBe(chartHasDenseCloud);

  const chartHasStability = (await chart.locator('[class*="meteo-gram-stab-"]').count()) > 0;
  const keyHasStability = (await key.locator(".meteo-gram-key-title").count()) > 0;
  expect(keyHasStability, "stability key parity").toBe(chartHasStability);

  const ids = await chart.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
  ids.push(...await key.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id)));
  expect(new Set(ids).size, "chart/key ids stay unique").toBe(ids.length);
}

test("the site inherits the package's white wind barbs and slate outline", async ({ page }) => {
  await page.goto("/docs/briefing/reading-a-meteogram/", { waitUntil: "networkidle" });
  const chart = page.locator("#example-meteogram [data-meteogram-mount] svg");
  const barb = chart.locator(".meteo-gram-barb").first();
  const outline = chart.locator(".meteo-gram-barb-halo").first();

  await expect(barb).toBeVisible();
  await expect(outline).toBeVisible();
  await expect(barb).toHaveCSS("stroke", cssRgb(TOKEN_DEFAULTS.wind));
  await expect(outline).toHaveCSS("stroke", cssRgb(TOKEN_DEFAULTS["halo-barb"]));

  const barbWidth = Number.parseFloat(await barb.evaluate((element) => getComputedStyle(element).strokeWidth));
  const outlineWidth = Number.parseFloat(await outline.evaluate((element) => getComputedStyle(element).strokeWidth));
  expect(outlineWidth).toBeGreaterThan(barbWidth);
});

test("the scene-derived key follows layer toggles and Reset", async ({ page }) => {
  await page.goto("/docs/briefing/reading-a-meteogram/", { waitUntil: "networkidle" });
  const figure = page.locator("#example-meteogram");
  const chart = figure.locator("[data-meteogram-mount] svg");
  const key = figure.locator("[data-meteogram-key-mount] svg");
  const status = figure.locator("[data-meteogram-key-status]");

  await expect(chart).toHaveCount(1);
  await expect(key).toHaveCount(1);
  await expect(key).toHaveAttribute("role", "img");
  await expect(key).toHaveAttribute("aria-label", /.+/);
  await expect(key.locator('[role="img"]')).toHaveAttribute("aria-label", /.+/);
  await expectKeyMatchesChart(chart, key);
  const exposedOverlays = await figure.locator("[data-meteogram-overlay]").evaluateAll((controls) =>
    controls.map((control) => (control as HTMLElement).dataset.meteogramOverlay).sort(),
  );
  expect(exposedOverlays).toEqual(Object.keys(DEFAULT_OVERLAYS).sort());
  const surfaceTemperature = figure.getByLabel("Surface temperature", { exact: true });
  const surfaceTemperatureMarks = chart.locator(".meteo-gram-surface-temp");
  const initialSurfaceTemperatureCount = await surfaceTemperatureMarks.count();
  expect(initialSurfaceTemperatureCount).toBeGreaterThan(0);
  await expect(surfaceTemperature).toBeChecked();
  await expect(surfaceTemperatureMarks).toHaveCount(initialSurfaceTemperatureCount);
  await surfaceTemperature.uncheck();
  await expect(surfaceTemperatureMarks).toHaveCount(0);
  await surfaceTemperature.check();
  await expect(surfaceTemperatureMarks).toHaveCount(initialSurfaceTemperatureCount);

  await figure.getByLabel("Usable lift", { exact: true }).uncheck();
  await expect(chart.locator(".meteo-gram-series-usable")).toHaveCount(0);
  await expect(key.locator(".meteo-gram-series-usable")).toHaveCount(0);
  await expect(status).not.toBeEmpty();

  await figure.getByLabel("Stability", { exact: true }).uncheck();
  await expect(key.locator(".meteo-gram-key-title")).toHaveCount(0);
  await expectKeyMatchesChart(chart, key);

  await figure.getByRole("button", { name: "Reset layers" }).click();
  await expect(figure.getByLabel("Usable lift", { exact: true })).toBeChecked();
  await expect(figure.getByLabel("Stability", { exact: true })).toBeChecked();
  await expectKeyMatchesChart(chart, key);

  // A back/forward-cache restoration can retain a form state that differs
  // from the server frame. The chart/key initialization handshake must
  // publish that restored scene regardless of component script order.
  await figure.getByLabel("Usable lift", { exact: true }).uncheck();
  await page.goto("/docs/", { waitUntil: "networkidle" });
  await page.goBack({ waitUntil: "networkidle" });
  const restoredFigure = page.locator("#example-meteogram");
  await expectKeyMatchesChart(
    restoredFigure.locator("[data-meteogram-mount] svg"),
    restoredFigure.locator("[data-meteogram-key-mount] svg"),
  );
});

test("the complete chart and key remain contained on mobile, print, and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/briefing/reading-a-meteogram/", { waitUntil: "networkidle" });

  const figure = page.locator("#example-meteogram");
  await expect(figure).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(figure.locator("[data-meteogram-key-mount]")).not.toHaveAttribute("aria-live", /.+/);

  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  await expect(figure.locator("[data-meteogram-key-mount] svg")).toHaveCSS("width", /.+px/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
