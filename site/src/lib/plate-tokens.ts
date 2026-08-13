import { STABILITY_TOKEN_DEFAULTS, TOKEN_DEFAULTS } from "@azohra/meteo.briefing/meteogram";

export function plateTokensStyle(): string {
  const stabilityTokens = Object.entries(STABILITY_TOKEN_DEFAULTS)
    .map(([name, hex]) => `--stab-${name}: ${hex};`)
    .join(" ");
  /* strip-bg is chrome — figures.css themes it; only face tokens pin here. */
  const packageTokens = (["pbl", "cloud-marker", "cloud-base"] as const)
    .map((name) => `--meteo-gram-${name}: ${TOKEN_DEFAULTS[name]};`)
    .join(" ");
  return `:root { ${stabilityTokens} ${packageTokens} }`;
}
