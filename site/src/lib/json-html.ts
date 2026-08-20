/* Syntax-coloured JSON-as-HTML: the one home for the terminal panels'
   t-key / t-str / t-num / t-nul span vocabulary, shared by the forecast,
   briefing, and station exhibits. */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** `<span class="t-key">…</span>` — object keys and code keywords. */
export const tKey = (text: string): string => `<span class="t-key">${escapeHtml(text)}</span>`;

/** `<span class="t-str">"…"</span>` — a quoted string value. */
export const tStr = (text: string): string => `<span class="t-str">"${escapeHtml(text)}"</span>`;

/** `<span class="t-num">…</span>` — a number value. */
export const tNum = (value: number): string => `<span class="t-num">${value}</span>`;

/** Pretty-print parsed JSON as syntax-coloured HTML (two-space indent)
    for a `<pre set:html>`. */
export function renderJsonHtml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null) return `<span class="t-nul">null</span>`;
  if (typeof value === "boolean") return `<span class="t-nul">${value}</span>`;
  if (typeof value === "number") return tNum(value);
  if (typeof value === "string") return tStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${pad}  ${renderJsonHtml(item, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entry]) => `${pad}  ${tKey(`"${key}"`)}: ${renderJsonHtml(entry, indent + 1)}`,
  );
  if (entries.length === 0) return "{}";
  return `{\n${entries.join(",\n")}\n${pad}}`;
}
