import { defineConfig } from "tsdown";

/* Unbundled, in-place emit: tsc overwrote dist in place; a clean would
   open a window where a concurrently-running sibling resolves a
   half-deleted dist. */
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/client/index.ts",
    "src/fixtures.ts",
    "src/server/index.ts",
    "src/react/index.ts",
    "src/elements/index.ts",
    "src/elements/register.ts",
    "src/internal/schema-artifacts.ts",
  ],
  unbundle: true,
  clean: false,
  fixedExtension: false,
  dts: true,
});
