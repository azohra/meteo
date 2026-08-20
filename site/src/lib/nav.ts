export type NavKey = "briefing" | "forecast" | "station" | "docs" | "logbook" | "about";

export interface NavLink {
  label: string;
  href: string;
  key: NavKey;
}

export const PRODUCT_LINKS: readonly NavLink[] = [
  { label: "Briefing", href: "/briefing/", key: "briefing" },
  { label: "Forecast", href: "/forecast/", key: "forecast" },
  { label: "Station", href: "/station/", key: "station" },
];

export const DOCS_LINK: NavLink = { label: "Docs", href: "/docs/", key: "docs" };

export const QUIET_LINKS: readonly NavLink[] = [
  { label: "Logbook", href: "/logbook/", key: "logbook" },
  { label: "About", href: "/about/", key: "about" },
];

export const GITHUB_URL = "https://github.com/azohra/meteo";

export const NAV_LINKS: readonly NavLink[] = [...PRODUCT_LINKS, DOCS_LINK, ...QUIET_LINKS];
