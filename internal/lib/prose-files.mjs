import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* Shared plumbing for the content gates: which files carry prose, and
   which lines of a file ARE prose. Each gate keeps its own rules. */

/* A Dirent reports isDirectory() === false for a symlinked directory, so the
   walk stat-follows symlinks to descend the committed docs symlinks. */
export function walk(dir, extensions, out = [], { skip = [] } = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || skip.includes(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) walk(full, extensions, out, { skip });
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
  return out;
}

/** Every workspace member's README.md plus the repository root's. */
export function workspaceReadmes(repoRoot) {
  const readmes = [];
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    const readme = join(repoRoot, entry.name, "README.md");
    if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(readme)) {
      readmes.push(readme);
    }
  }
  readmes.push(join(repoRoot, "README.md"));
  return readmes;
}

/** The gates' opt-out convention: the marker on the same or preceding line. */
export function ignoredLine(lines, index, marker) {
  return lines[index].includes(marker) || (index > 0 && lines[index - 1].includes(marker));
}

/** The text with fenced code blocks removed. */
export function stripFences(text) {
  return text.replace(/^```.*$[\s\S]*?^```\s*$/gm, "");
}

/** [lineNumber, line] pairs outside code fences (fence delimiters excluded). */
export function proseLines(text) {
  const out = [];
  let inFence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push([index + 1, line]);
  });
  return out;
}

/* Site components and pages are rendered prose too: the conventions hold
   wherever a reader sees the words. Only what renders is returned — .astro
   frontmatter script (between the leading --- pair), HTML and JS/CSS
   comments, comment-only // lines, and fenced code are code, not prose. */
export function renderedProseLines(file, text) {
  const lines = text.split("\n");
  const out = [];
  let start = 0;
  if (file.endsWith(".astro") && lines[0]?.trim() === "---") {
    start = 1;
    while (start < lines.length && lines[start].trim() !== "---") start += 1;
    start += 1;
  }
  let inFence = false;
  /* null, or the closer of the comment a previous line left open. */
  let openComment = null;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (openComment === null && /^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let visible = "";
    let pos = 0;
    while (pos < line.length) {
      if (openComment !== null) {
        const end = line.indexOf(openComment, pos);
        if (end === -1) {
          pos = line.length;
        } else {
          pos = end + openComment.length;
          openComment = null;
        }
        continue;
      }
      if (visible.trim() === "" && line.slice(pos).trimStart().startsWith("//")) break;
      const html = line.indexOf("<!--", pos);
      const block = line.indexOf("/*", pos);
      const next = Math.min(html === -1 ? Infinity : html, block === -1 ? Infinity : block);
      if (next === Infinity) {
        visible += line.slice(pos);
        break;
      }
      visible += line.slice(pos, next);
      openComment = next === html ? "-->" : "*/";
      pos = next + (next === html ? 4 : 2);
    }
    out.push([index + 1, visible]);
  }
  return out;
}
