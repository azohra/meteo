import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Corpus decodes sit near vitest's 5 s default and cross it under
    // full gate-lane contention.
    testTimeout: 30_000,
  },
});
