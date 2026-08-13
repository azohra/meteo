import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rehypeInlineFigures } from "./src/lib/rehype-inline-figures.mjs";
import { sidebar } from "./src/lib/sidebar.mjs";
import { SOCIAL_CARD } from "./src/lib/social-card.mjs";

const contentInputDirectories = ["../scenarios"].map((directory) =>
  fileURLToPath(new URL(directory, import.meta.url)),
);

const siteUrl = "https://meteo.azohra.com";

// Link-preview card for every docs page — facts live in src/lib/social-card.mjs;
// Starlight already emits og:title/og:description and twitter:card, so only
// the image is added here.
const socialCard = new URL(SOCIAL_CARD.path, siteUrl).href;

/* The schemas' $id URLs live under this site (meteo.azohra.com/schema/),
   so the build publishes the committed schema artifacts at those paths —
   otherwise every emitted $id is a dead link. Each capability package owns
   its schema/ directory now, so the hook copies from BOTH; the published
   URL space is unchanged (one flat /schema/). */
const publishSchemaArtifacts = {
  name: "publish-schema-artifacts",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const sources = ["../briefing/schema", "../station/schema"].map((directory) =>
        fileURLToPath(new URL(directory, import.meta.url)),
      );
      const target = new URL("schema/", dir);
      await mkdir(target, { recursive: true });
      for (const source of sources) {
        for (const file of await readdir(source)) {
          if (!file.endsWith(".json")) continue;
          await copyFile(`${source}/${file}`, new URL(file, target));
        }
      }
    },
  },
};

const watchRepositoryContent = {
  name: "watch-repository-content",
  buildStart() {
    for (const directory of contentInputDirectories) this.addWatchFile(directory);
  },
  configureServer(server) {
    server.watcher.add(contentInputDirectories);
  },
  handleHotUpdate({ file, server }) {
    if (!contentInputDirectories.some((directory) => file.startsWith(`${directory}/`))) return;
    server.moduleGraph.invalidateAll();
    server.ws.send({ type: "full-reload" });
    return [];
  },
};

export default defineConfig({
  site: siteUrl,
  // The only content images are the pre-rendered documentation figure SVGs
  // ingested from the capability docs directories; they are committed
  // finished assets, so no raster optimizer (sharp) is wanted or installed.
  image: { service: passthroughImageService() },
  // Local figures/*.svg images in Markdown docs are inlined as real <svg>
  // elements so the page's --meteo-gram-* chrome tokens reach the plates;
  // see src/lib/rehype-inline-figures.mjs for the doctrine and the scope.
  markdown: { rehypePlugins: [rehypeInlineFigures] },
  integrations: [
    publishSchemaArtifacts,
    starlight({
      title: "meteo by Azohra",
      description:
        "Documentation for the @azohra/meteo packages: publish forecasts for your launches, render them as Meteograms, and show live launch wind.",
      favicon: "/favicon.svg",
      head: [
        { tag: "meta", attrs: { property: "og:image", content: socialCard } },
        { tag: "meta", attrs: { property: "og:image:width", content: SOCIAL_CARD.width } },
        { tag: "meta", attrs: { property: "og:image:height", content: SOCIAL_CARD.height } },
        { tag: "meta", attrs: { property: "og:image:alt", content: SOCIAL_CARD.alt } },
        { tag: "meta", attrs: { name: "twitter:image", content: socialCard } },
      ],
      customCss: [
        // Site chrome: one face, Instrument Sans Variable. IBM Plex stays
        // ONLY as the Meteogram plates' own reference type (gram/svg
        // TOKEN_DEFAULTS names it) — the artifact's face, not the brand's.
        "@fontsource-variable/instrument-sans",
        "@fontsource/ibm-plex-sans/400.css",
        "@fontsource/ibm-plex-sans/600.css",
        "@fontsource/ibm-plex-sans/700.css",
        "@fontsource/ibm-plex-mono/400.css",
        "/src/styles/starlight.css",
        // Docs pages inline the committed figure plates as real <svg>
        // (markdown.rehypePlugins above); figures.css carries their frame,
        // legend, and caption styles. The :root --meteo-gram-* chrome
        // tokens the plates follow live in theme.css (via starlight.css).
        "/src/styles/figures.css",
      ],
      components: {
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        Header: "./src/components/starlight/Header.astro",
        Footer: "./src/components/starlight/Footer.astro",
        MobileMenuToggle: "./src/components/starlight/MobileMenuToggle.astro",
        MobileMenuFooter: "./src/components/starlight/MobileMenuFooter.astro",
      },
      editLink: {
        baseUrl: "https://github.com/azohra/meteo/edit/main/site/",
      },
      routeMiddleware: "./src/starlight-route-data.ts",
      pagefind: true,
      sidebar,
    }),
    mdx(),
    // robots.txt names /sitemap-index.xml; this integration is what makes
    // that line true.
    sitemap(),
  ],
  vite: {
    plugins: [watchRepositoryContent],
    server: { fs: { allow: [".."] } },
  },
});
