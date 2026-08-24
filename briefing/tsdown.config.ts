import { defineConfig } from "tsdown";

/* Unbundled, in-place emit: tsc overwrote dist in place; a clean would
   open a window where a concurrently-running sibling resolves a
   half-deleted dist. */
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/contract.ts",
    "src/derive/index.ts",
    "src/analyze/index.ts",
    "src/compare.ts",
    "src/transport.ts",
    "src/history/index.ts",
    "src/meteogram.ts",
    "src/compare-board/index.ts",
    "src/sounding.ts",
    "src/internal/schema-artifacts.ts",
  ],
  unbundle: true,
  clean: false,
  fixedExtension: false,
  dts: true,
});
