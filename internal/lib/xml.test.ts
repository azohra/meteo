import { describe, expect, it } from "vitest";

import { escapeXml } from "./xml.mjs";

describe("escapeXml", () => {
  it("escapes text and both quoted attribute boundaries", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
