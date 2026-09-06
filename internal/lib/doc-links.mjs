const SITE_ORIGIN = "https://meteo.azohra.com";

export function sitePathForTarget(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.origin !== SITE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
