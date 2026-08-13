/* Build-time helpers for the /forecast/ exhibit. The page shows the
   committed sample dataset's own bytes, so everything here turns real
   parsed JSON and real file sizes into the page's terminal panels —
   nothing is typed out by hand. Pure functions only: the Playwright spec
   imports formatBytes to hold the rendered sizes to the files on disk. */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** 1442341697 → "1.44 GB", 10053 → "10.1 kB", 170 → "170 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${bytes} B`;
}

/** Pretty-print parsed JSON as syntax-coloured HTML (two-space indent;
    t-key / t-str / t-num / t-nul spans) for a `<pre set:html>`. */
export function renderJsonHtml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null) return `<span class="t-nul">null</span>`;
  if (typeof value === "boolean") return `<span class="t-nul">${value}</span>`;
  if (typeof value === "number") return `<span class="t-num">${value}</span>`;
  if (typeof value === "string") return `<span class="t-str">"${escapeHtml(value)}"</span>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${pad}  ${renderJsonHtml(item, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entry]) =>
      `${pad}  <span class="t-key">"${escapeHtml(key)}"</span>: ${renderJsonHtml(entry, indent + 1)}`,
  );
  if (entries.length === 0) return "{}";
  return `{\n${entries.join(",\n")}\n${pad}}`;
}
