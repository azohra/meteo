import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/j2k-node.ts", "src/j2k-worker.ts"],
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
    testTimeout: 120_000,
  },
});
