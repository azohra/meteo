import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/client/index.ts",
      "src/fixtures.ts",
      "src/server/index.ts",
      "src/react/index.ts",
      "src/elements/index.ts",
      "src/elements/register.ts",
      /* Not exported: the schema-emit table internal/emit-schemas.ts loads
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
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
