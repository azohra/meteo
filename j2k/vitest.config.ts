import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Codestream decodes are compute-bound and these run whole-image
    // comparisons; vitest's 5s default is calibrated to nothing in
    // particular, and a CI runner is several times slower than a
    // workstation. grib carries the same allowance for the same reason.
    testTimeout: 30_000,
  },
});
