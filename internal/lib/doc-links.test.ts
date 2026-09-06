import { describe, expect, it } from "vitest";

import { sitePathForTarget } from "./doc-links.mjs";

describe("sitePathForTarget", () => {
  it("returns routes only for the exact Meteo origin", () => {
    expect(sitePathForTarget("https://meteo.azohra.com")).toBe("/");
    expect(sitePathForTarget("https://meteo.azohra.com/guide/?view=full#setup")).toBe(
      "/guide/?view=full#setup",
    );
    expect(sitePathForTarget("https://meteo.azohra.com.evil.example/guide/")).toBeNull();
    expect(sitePathForTarget("https://meteo.azohra.com:8443/guide/")).toBeNull();
  });
});
