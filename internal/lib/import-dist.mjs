import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* Import a workspace package's built dist with a build-first error.
   `subpath` is `<packageDir>` or `<packageDir>/<entry...>`; a flat
   dist/<entry>.js resolves before dist/<entry>/index.js so a stale
   directory ghost can never shadow it. */
export async function importDist(root, subpath) {
  const [head, ...rest] = subpath.split("/");
  const dist = join(root, head, "dist");
  const flat = rest.length > 0 ? join(dist, `${rest.join("/")}.js`) : null;
  const barrel = rest.length > 0 ? join(dist, ...rest, "index.js") : join(dist, "index.js");
  const entry = flat && existsSync(flat) ? flat : barrel;
  try {
    return await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new Error(
      `Cannot load ${head}/dist/${rest.join("/") || "index"} — build the workspace first ` +
        `(pnpm build). ${error.message}`,
    );
  }
}
