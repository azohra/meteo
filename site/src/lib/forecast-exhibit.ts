/* Build-time helpers for the /forecast/ exhibit. The page shows the
   committed sample dataset's own bytes, so everything here turns real
   file sizes into the page's terminal panels — nothing is typed out by
   hand. Pure functions only: the Playwright spec imports formatBytes to
   hold the rendered sizes to the files on disk. */

/** 1442341697 → "1.44 GB", 10053 → "10.1 kB", 170 → "170 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${bytes} B`;
}
