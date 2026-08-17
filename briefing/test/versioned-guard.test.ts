import { describe, expect, it } from "vitest";
import { z } from "zod";
import { versionedGuard } from "../src/contract.js";

/* A synthetic two-version family: v1 said `name`, v2 renamed it to `title`.
   The real families are all single-link today; this chain proves the
   mechanism the first real bump will ride. */
type NewestShape = { schemaVersion: 2; title: string };

const guard = versionedGuard<NewestShape>([
  {
    version: 1,
    schema: z.object({ schemaVersion: z.literal(1), name: z.string() }),
    upgrade: (document) => {
      const v1 = document as { name: string };
      return { schemaVersion: 2, title: v1.name };
    },
  },
  {
    version: 2,
    schema: z.object({ schemaVersion: z.literal(2), title: z.string() }),
  },
]);

describe("versionedGuard", () => {
  it("normalizes an old version up to the newest shape", () => {
    expect(guard.parse({ schemaVersion: 1, name: "dundee" })).toEqual({
      schemaVersion: 2,
      title: "dundee",
    });
  });

  it("parses the newest version as itself", () => {
    expect(guard.parse({ schemaVersion: 2, title: "dundee" })).toEqual({
      schemaVersion: 2,
      title: "dundee",
    });
  });

  it("refuses a version the chain has never heard of — newer writers stay a loud invalid", () => {
    expect(guard.parse({ schemaVersion: 3, title: "dundee" })).toBeNull();
  });

  it("a declared version must still satisfy that version's schema", () => {
    expect(guard.parse({ schemaVersion: 1, title: "wrong-field-for-v1" })).toBeNull();
  });

  it("refuses non-documents", () => {
    expect(guard.parse(null)).toBeNull();
    expect(guard.parse([1, 2])).toBeNull();
    expect(guard.parse("text")).toBeNull();
    expect(guard.parse({ noVersion: true })).toBeNull();
  });

  it("names what it speaks: every supported version and the one writers emit", () => {
    expect(guard.supportedVersions).toEqual([1, 2]);
    expect(guard.newestVersion).toBe(2);
  });
});
