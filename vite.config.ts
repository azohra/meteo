import { defineConfig } from "vite-plus";

/* The workspace shell's toolchain config: lint and fmt for the whole
   platform, the shell's own tests, and the shell dist build (capabilities
   manifest + schema emitter) that the internal tooling runs from.

   The site keeps its own toolchain (Astro drives its own Vite; Playwright
   drives its tests); only site/src is linted and formatted from here —
   exactly the surface the old root glob scripts covered. */

const SITE_NON_SRC = ["site/*.{ts,mjs,cjs}", "site/test/**", "site/public/**"];

export default defineConfig({
  lint: {
    categories: {
      correctness: "error",
    },
    rules: {
      // The elements and client code deliberately snapshots listener sets
      // ([...listeners]) before invoking callbacks that may mutate them
      // mid-iteration; this rule reads those defensive copies as useless.
      "unicorn/no-useless-spread": "off",
      "unicorn/no-useless-fallback-in-spread": "off",
    },
    ignorePatterns: [
      "dist/**",
      "site/dist/**",
      "site/.astro/**",
      "node_modules/**",
      "**/*.json",
      ...SITE_NON_SRC,
    ],
  },
  fmt: {
    /* The formatter owns exactly the surface the old glob scripts owned:
       TypeScript and the internal tooling's .mjs. Markdown, JSON, CSS, and
       YAML were never formatter-managed here. */
    ignorePatterns: [
      "dist/**",
      "site/dist/**",
      "site/.astro/**",
      "**/*.{md,mdx}",
      "**/*.{json,jsonc}",
      "**/*.css",
      "**/*.{yml,yaml}",
      "site/src/**/*.mjs",
      ...SITE_NON_SRC,
    ],
  },
  test: {
    include: ["internal/**/*.test.ts"],
  },
  pack: {
    entry: ["capabilities.ts", "internal/emit-schemas.ts"],
    unbundle: true,
    /* tsc overwrote dist in place; a clean would open a window where a
       concurrently-running sibling (pnpm -r test triggers dependency
       rebuilds) resolves a half-deleted dist. Same-in-place semantics. */
    clean: false,
    fixedExtension: false,
    dts: false,
    deps: { neverBundle: true },
  },
});
