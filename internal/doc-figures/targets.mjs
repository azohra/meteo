import { AUTHORED_FIGURE_TARGETS } from "./authored-figures.mjs";
import { fitSize, MONO, placeChart, round, t } from "./compose-helpers.mjs";
import { PAGE_FIGURE_TARGETS } from "./page-figures.mjs";

/* The link-preview card belongs to the website identity, while the chart on
   it remains the renderer's reference artifact. Keep the two palettes at
   their declared boundary. */
const SITE_PAGE = "#eef1f5";
const SITE_SURFACE = "#ffffff";
const SITE_RULE = "#dbe2e9";
const SITE_INK = "#17232e";
const SITE_INK_SOFT = "#3b4a58";
const SITE_INK_MUTE = "#5b6a79";
const SITE_ACCENT = "#0f7490";

/* The README hero uses the site's pre-dawn palette. A single static dark
   plate holds its contrast in both GitHub themes and matches the homepage
   palette instead of introducing a second one. */
const NIGHT_PAGE = "#0d1319";
const NIGHT_SURFACE = "#10161d";
const NIGHT_RAISED = "#212d3a";
const NIGHT_RULE = "#2b3844";
const NIGHT_INK = "#e7edf3";
const NIGHT_INK_SOFT = "#c2cdd8";
const NIGHT_INK_MUTE = "#95a4b3";
const NIGHT_ACCENT = "#45c3e0";

function sitePaper(id, width, height, rx = 0) {
  return `<defs>
    <pattern id="${id}-site-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${SITE_RULE}" stroke-opacity=".38" stroke-width="1"/>
    </pattern>
    <marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0 0l10 5-10 5z" fill="${SITE_ACCENT}"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="${rx}" fill="${SITE_PAGE}"/>
  <rect width="${width}" height="${height}" rx="${rx}" fill="url(#${id}-site-grid)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${rx > 0 ? rx - 1 : 0}" fill="none" stroke="${SITE_RULE}" stroke-width="2"/>`;
}

function socialMark(color = SITE_ACCENT) {
  return `<g>
    <path d="M4 27V18C4 12.5 7.5 9 12 9S20 12.5 20 18V27" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"/>
    <path d="M20 27V18C20 12.5 23.5 9 28 9S36 12.5 36 18V5" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"/>
    <path d="M32 9L36 5L40 9" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"/>
  </g>`;
}

function readmePackageCard(x, y, width, name, detail) {
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="62" rx="8" fill="${NIGHT_RAISED}" stroke="${NIGHT_RULE}"/>
    ${t(14, 27, name, { size: 16, weight: 700, fill: NIGHT_INK })}
    ${t(14, 47, detail, { font: MONO, size: 9.5, fill: NIGHT_INK_MUTE })}
  </g>`;
}

function readmeFlow(x1, y, x2) {
  return `<path d="M${x1} ${y}H${x2}" fill="none" stroke="${NIGHT_ACCENT}" stroke-opacity=".72" stroke-width="1.5" marker-end="url(#readme-hero-flow-arrow)"/>`;
}

function composeReadmeHero() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 660" role="img" aria-labelledby="readme-title readme-description">
  <title id="readme-title">meteo by Azohra — forecasts and live wind, built in the open</title>
  <desc id="readme-description">A pre-dawn instrument panel for meteo by Azohra. The lift-mark lockup and project statement sit beside a map of the repository's six TypeScript packages: j2k and grib decode forecast-model bytes, forecast publishes static documents, briefing reads and renders them, station normalizes live feeds and supplies components, and core provides their shared units, contracts, and wind math.</desc>
  <defs>
    <pattern id="readme-hero-grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M36 0H0V36" fill="none" stroke="${NIGHT_RULE}" stroke-opacity=".2"/>
    </pattern>
    <linearGradient id="readme-hero-band" x1="0" x2="1">
      <stop offset="0" stop-color="#5fb2e0"/>
      <stop offset=".25" stop-color="#34d17b"/>
      <stop offset=".5" stop-color="#eab308"/>
      <stop offset=".75" stop-color="#f4732c"/>
      <stop offset="1" stop-color="#ef4444"/>
    </linearGradient>
    <marker id="readme-hero-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0 0l10 5-10 5z" fill="${NIGHT_ACCENT}" fill-opacity=".72"/>
    </marker>
    <clipPath id="readme-hero-clip"><rect width="1200" height="660" rx="20"/></clipPath>
  </defs>
  <g clip-path="url(#readme-hero-clip)">
    <rect width="1200" height="660" fill="${NIGHT_PAGE}"/>
    <rect width="1200" height="660" fill="url(#readme-hero-grid)"/>
    <g fill="none" stroke="${NIGHT_ACCENT}" opacity=".08">
      <path d="M-80 514C170 452 318 592 548 508S896 272 1280 352"/>
      <path d="M-80 556C170 494 318 634 548 550S896 314 1280 394"/>
      <path d="M-80 598C170 536 318 676 548 592S896 356 1280 436"/>
      <path d="M-80 640C170 578 318 718 548 634S896 398 1280 478"/>
    </g>
  </g>
  <rect x="1" y="1" width="1198" height="658" rx="19" fill="none" stroke="${NIGHT_RULE}" stroke-width="2"/>

  <g transform="translate(62 38)">
    <g transform="scale(1.25)">${socialMark(NIGHT_ACCENT)}</g>
    ${t(62, 28, "meteo", { size: 34, weight: 700, fill: NIGHT_INK })}
    ${t(166, 26, "BY AZOHRA", { font: MONO, size: 9, weight: 700, ls: 1.25, fill: NIGHT_INK_MUTE })}
    ${t(62, 47, "OPEN METEOROLOGY FOR MOUNTAIN FLYING", { font: MONO, size: 8.5, weight: 700, ls: 1.08, fill: NIGHT_INK_MUTE })}
  </g>
  ${t(1138, 68, "SIX TYPESCRIPT PACKAGES · ONE OPEN PLATFORM", { font: MONO, size: 10, weight: 700, ls: 1.15, fill: NIGHT_INK_MUTE, anchor: "end" })}
  <path d="M62 106H1138" stroke="${NIGHT_RULE}"/>

  <g transform="translate(62 144)">
    <path d="M0 0h24" stroke="${NIGHT_ACCENT}"/>
    ${t(36, 4, "OPEN PACKAGES FOR CLUB BUILDERS", { font: MONO, size: 10.5, weight: 700, ls: 1.25, fill: NIGHT_ACCENT })}
    ${t(0, 76, "Forecasts and live wind,", { size: 46, weight: 700, fill: NIGHT_INK })}
    ${t(0, 130, "built in the open.", { size: 46, weight: 700, fill: NIGHT_INK })}
    <rect y="157" width="112" height="4" rx="2" fill="url(#readme-hero-band)"/>
    ${t(0, 208, "Six TypeScript packages read weather models,", { size: 18, fill: NIGHT_INK_SOFT })}
    ${t(0, 238, "publish point forecasts, normalize station feeds,", { size: 18, fill: NIGHT_INK_SOFT })}
    ${t(0, 268, "and render instruments for mountain flying.", { size: 18, fill: NIGHT_INK_SOFT })}
    ${t(0, 350, "ECCC + NOAA · STATIC JSON · REACT + ELEMENTS", { font: MONO, size: 10.5, weight: 700, ls: 1.15, fill: NIGHT_INK_MUTE })}
    ${t(0, 404, "METEO.AZOHRA.COM", { font: MONO, size: 13, weight: 700, ls: 1.8, fill: NIGHT_ACCENT })}
  </g>

  <g transform="translate(606 128)">
    <rect width="532" height="470" rx="12" fill="${NIGHT_RAISED}" stroke="${NIGHT_RULE}"/>
    <path d="M1 1h530" stroke="${NIGHT_ACCENT}" stroke-opacity=".78"/>
    ${t(26, 42, "INSIDE THE REPOSITORY", { font: MONO, size: 11, weight: 700, ls: 1.4, fill: NIGHT_ACCENT })}
    <g transform="translate(462 21) scale(.95)" opacity=".72">${socialMark(NIGHT_ACCENT)}</g>

    <g transform="translate(24 68)">
      <rect width="484" height="188" rx="9" fill="${NIGHT_SURFACE}" stroke="${NIGHT_RULE}"/>
      ${t(18, 26, "FORECAST DATA", { font: MONO, size: 10.5, weight: 700, ls: 1.15, fill: NIGHT_INK_MUTE })}
      ${readmePackageCard(18, 46, 98, "j2k", "JPEG 2000")}
      ${readmeFlow(116, 77, 134)}
      ${readmePackageCard(136, 46, 98, "grib", "GRIB2 + grids")}
      ${readmeFlow(234, 77, 252)}
      ${readmePackageCard(254, 46, 98, "forecast", "build + publish")}
      ${readmeFlow(352, 77, 370)}
      ${readmePackageCard(372, 46, 94, "briefing", "read + render")}
      <path d="M18 133H466" stroke="${NIGHT_RULE}"/>
      ${t(18, 159, "PROVIDER BYTES", { font: MONO, size: 9.5, weight: 700, fill: NIGHT_INK_MUTE })}
      ${t(242, 159, "STATIC, VERSIONED DOCUMENTS", { font: MONO, size: 9.5, weight: 700, fill: NIGHT_INK_MUTE, anchor: "middle" })}
      ${t(466, 159, "METEOGRAMS", { font: MONO, size: 9.5, weight: 700, fill: NIGHT_ACCENT, anchor: "end" })}
    </g>

    <g transform="translate(24 272)">
      <rect width="484" height="116" rx="9" fill="${NIGHT_SURFACE}" stroke="${NIGHT_RULE}"/>
      ${t(18, 26, "LIVE STATION DATA", { font: MONO, size: 10.5, weight: 700, ls: 1.15, fill: NIGHT_INK_MUTE })}
      <rect x="18" y="44" width="112" height="50" rx="7" fill="${NIGHT_RAISED}" stroke="${NIGHT_RULE}"/>
      ${t(74, 66, "VENDOR FEEDS", { font: MONO, size: 9.5, weight: 700, fill: NIGHT_INK_MUTE, anchor: "middle" })}
      ${t(74, 82, "one wire", { font: MONO, size: 9, fill: NIGHT_INK_MUTE, anchor: "middle" })}
      ${readmeFlow(130, 69, 154)}
      <rect x="156" y="44" width="132" height="50" rx="7" fill="${NIGHT_RAISED}" stroke="${NIGHT_RULE}"/>
      ${t(222, 67, "station", { size: 16, weight: 700, fill: NIGHT_INK, anchor: "middle" })}
      ${t(222, 83, "feed + adapters", { font: MONO, size: 9, fill: NIGHT_INK_MUTE, anchor: "middle" })}
      ${readmeFlow(288, 69, 312)}
      <rect x="314" y="44" width="152" height="50" rx="7" fill="${NIGHT_RAISED}" stroke="${NIGHT_RULE}"/>
      ${t(390, 66, "LIVE COMPONENTS", { font: MONO, size: 9.5, weight: 700, fill: NIGHT_ACCENT, anchor: "middle" })}
      ${t(390, 82, "React + elements", { font: MONO, size: 9, fill: NIGHT_INK_MUTE, anchor: "middle" })}
    </g>

    <g transform="translate(24 404)">
      <rect width="484" height="42" rx="8" fill="#14262f" stroke="${NIGHT_ACCENT}" stroke-opacity=".35"/>
      ${t(18, 27, "core", { size: 16, weight: 700, fill: NIGHT_ACCENT })}
      ${t(466, 26, "UNITS · CONTRACTS · WIND MATH", { font: MONO, size: 9.5, weight: 700, ls: 1.05, fill: NIGHT_INK_MUTE, anchor: "end" })}
    </g>
  </g>
</svg>
`;
}

/* The README's Meteogram plate: the renderer's reference artifact on its own
   white paper, so it stays readable on both GitHub themes. Same committed
   convective-cycle scenario as the social card — one canonical teaching day
   everywhere the platform introduces the chart. */
async function composeReadmeMeteogram(ctx) {
  const chart = await ctx.renderChart("convective-cycle", "readme-meteogram-chart");
  const pad = 20;
  const width = chart.width + pad * 2;
  const height = chart.height + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="readme-meteogram-title readme-meteogram-desc">
  <title id="readme-meteogram-title">A Meteogram of a complete convective cycle</title>
  <desc id="readme-meteogram-desc">A Meteogram for one site and one day: pressure, precipitation, cloud, thermal velocity, and CAPE strips above a time-height wind field where the boundary layer, usable lift, and cloud base rise and fall beneath light veering wind.</desc>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="${SITE_SURFACE}" stroke="${SITE_RULE}" stroke-width="2"/>
  ${placeChart(chart, { x: pad, y: pad, width: chart.width }).markup}
</svg>
`;
}

async function composeSocialCard(ctx) {
  const chart = await ctx.renderChart("convective-cycle", "social-card-chart");
  const placed = placeChart(chart, { x: 652, y: 52, height: 526 });
  const titleSize = fitSize("meteo", 340, {
    family: "ibm-plex-sans",
    weight: 700,
    letterSpacingEm: -0.04,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" role="img" aria-labelledby="social-title social-description">
  <title id="social-title">meteo by Azohra — open meteorology for mountain flying</title>
  <desc id="social-description">The meteo by Azohra product lockup beside a Meteogram of a complete convective cycle.</desc>
  ${sitePaper("social-card", 1200, 630)}

  <g transform="translate(70 84)">
    ${socialMark()}
    ${t(64, 13, "OPEN METEOROLOGY FOR MOUNTAIN FLYING", { font: MONO, size: 12, weight: 700, ls: 1.55, fill: SITE_ACCENT })}
    ${t(0, 140, "meteo", { size: titleSize, weight: 700, ls: round(titleSize * -0.04), fill: SITE_INK })}
    ${t(364, 130, "BY AZOHRA", { font: MONO, size: 12, weight: 700, ls: 1.6, fill: SITE_INK_MUTE })}
    <path d="M2 160h460" stroke="${SITE_RULE}" stroke-width="1.5"/>
    ${t(0, 202, "Model runs become inspectable, versioned", { size: 21, fill: SITE_INK_SOFT })}
    ${t(0, 233, "profiles and charts any frontend can draw.", { size: 21, fill: SITE_INK_SOFT })}
    ${t(0, 330, "OPEN FORECASTS · LIVE STATIONS · STATIC JSON", { font: MONO, size: 12, weight: 700, ls: 1.2, fill: SITE_INK_MUTE })}
    ${t(0, 384, "METEO.AZOHRA.COM", { font: MONO, size: 15, weight: 700, ls: 2, fill: SITE_ACCENT })}
  </g>

  <rect x="640" y="40" width="520" height="550" rx="9" fill="${SITE_SURFACE}" stroke="${SITE_RULE}" stroke-width="1.5"/>
  ${placed.markup}
</svg>
`;
}

export const TARGETS = [
  { id: "readme-hero", file: "readme-hero.svg", compose: composeReadmeHero },
  { id: "readme-meteogram", file: "readme-meteogram.svg", compose: composeReadmeMeteogram },
  { id: "social-card", file: "site/assets/social-card.svg", compose: composeSocialCard },
  ...PAGE_FIGURE_TARGETS,
  ...AUTHORED_FIGURE_TARGETS,
];

export const RASTER_TARGETS = [
  {
    id: "social-card-png",
    source: "social-card",
    file: "site/public/social-card.png",
    width: 1200,
    height: 630,
  },
];
