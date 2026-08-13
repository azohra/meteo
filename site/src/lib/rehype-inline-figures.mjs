import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/* The committed documentation figures are printed plates whose chrome —
   canvas, rules, label ink, halos — is serialized as var(--meteo-gram-*,
   light-default) references. Served through <img> those custom properties
   can never receive the page's values, so the plates stay light on a dark
   page. Inlining each figure as a real <svg> puts the plate inside the
   page's cascade, where the :root chrome tokens (src/styles/figures.css)
   reach it — the same ancestor-token path a live-rendered meteogram
   follows. The face of the print (stability ramp, field fills, series
   colors) carries no ancestor values and holds its package defaults.

   Scope is deliberately narrow: only Markdown-authored, document-relative
   figures/*.svg images from the docs content are inlined. Remote images,
   absolute paths, non-SVG assets, and MDX-authored images keep their
   normal <img> handling. This runs as a user rehype plugin, i.e. before
   Astro's own rehype-images pass, so the replaced nodes never enter the
   image pipeline; the pruned localImagePaths keep Astro from importing
   the now-unreferenced asset copies. */

const FIGURE_SRC = /^(?:\.\/)?figures\/[\w.-]+\.svg$/;

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function inlineSvg(path, alt) {
  const svg = readFileSync(path, "utf8").trim();
  const openTag = /^<svg\b[^>]*>/.exec(svg);
  if (!openTag) throw new Error(`Figure ${path} is not a single-root <svg> document`);
  let open = openTag[0];
  /* Preserve the Markdown alt text on the inlined element. The generated
     figures also carry role="img" plus aria-labelledby onto their own
     <title>/<desc>, which keeps precedence where present. */
  if (!/\brole\s*=/.test(open)) open = open.replace("<svg", '<svg role="img"');
  if (alt && !/\baria-label\s*=/.test(open)) {
    open = open.replace("<svg", `<svg aria-label="${escapeAttribute(alt)}"`);
  }
  return open + svg.slice(openTag[0].length);
}

export function rehypeInlineFigures() {
  return (tree, file) => {
    /* MDX compiles hast to JSX and cannot carry raw nodes; every figure
       reference lives in plain Markdown, so .mdx files are left alone. */
    if (typeof file.path !== "string" || !file.path.endsWith(".md")) return;
    const directory = dirname(file.path);
    const inlined = new Set();

    const walk = (node) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.map((child) => {
        if (child.type !== "element") return child;
        walk(child);
        if (child.tagName !== "img") return child;
        const src = child.properties?.src;
        if (typeof src !== "string" || !FIGURE_SRC.test(src)) return child;
        const alt = typeof child.properties.alt === "string" ? child.properties.alt : "";
        const value = inlineSvg(resolve(directory, src), alt);
        inlined.add(src);
        return { type: "raw", value };
      });
    };
    walk(tree);

    if (inlined.size > 0 && Array.isArray(file.data.astro?.localImagePaths)) {
      file.data.astro.localImagePaths = file.data.astro.localImagePaths.filter(
        (path) => !inlined.has(path),
      );
    }
  };
}
