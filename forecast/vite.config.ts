import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/cli.ts",
      "src/scenario/contract.ts",
      /* Not exported: the schema-emit renderer internal/emit-schemas.ts loads
         from dist/internal/ at generation time (excluded from the publish
         via the manifest's "!dist/internal"). */
      "src/internal/schema-artifacts.ts",
    ],
    unbundle: true,
    /* tsc overwrote dist in place; a clean would open a window where a
       concurrently-running sibling (pnpm -r test triggers dependency
       rebuilds) resolves a half-deleted dist. Same-in-place semantics. */
    clean: false,
    fixedExtension: false,
    dts: true,
    deps: { neverBundle: true },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
