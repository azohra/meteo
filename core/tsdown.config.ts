import { defineConfig } from "tsdown";

/* Unbundled, in-place emit: tsc overwrote dist in place; a clean would
   open a window where a concurrently-running sibling resolves a
   half-deleted dist. */
export default defineConfig({
  entry: ["src/index.ts"],
  unbundle: true,
  clean: false,
  fixedExtension: false,
  dts: true,
});
