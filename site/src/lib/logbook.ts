import { getCollection, type CollectionEntry } from "astro:content";

const LOGBOOK_ENTRIES = await getCollection("logbook");

export interface LogbookEntry {
  slug: string;
  url: string;
  title: string;
  number: string;
  section: string;
  summary: string;
  accent: "amber" | "blue" | "green";
  readingMinutes: number;
  kind: CollectionEntry<"logbook">["data"]["kind"];
  published: Date;
  updated: Date;
  status: "current" | "historical";
  order: number;
  scenarios: string[];
  thumbnail: CollectionEntry<"logbook">["data"]["thumbnail"];
  entry: CollectionEntry<"logbook">;
}

function countWords(raw: string): number {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`[\]()]/g, " ")
    .trim()
    .split(/\s+/).length;
}

function logbookAccent(kind: CollectionEntry<"logbook">["data"]["kind"]): LogbookEntry["accent"] {
  if (kind === "experiment") return "amber";
  if (kind === "case-study") return "green";
  return "blue";
}

export function logbookEntries(): LogbookEntry[] {
  return LOGBOOK_ENTRIES.map((entry) => ({
    slug: entry.id.replace(/\/index$/, ""),
    url: `/logbook/${entry.id.replace(/\/index$/, "")}/`,
    title: entry.data.title,
    number: String(entry.data.order).padStart(2, "0"),
    section: entry.data.section,
    summary: entry.data.summary,
    accent: logbookAccent(entry.data.kind),
    readingMinutes: Math.max(2, Math.ceil(countWords(entry.body ?? "") / 220)),
    kind: entry.data.kind,
    published: entry.data.published,
    updated: entry.data.updated,
    status: entry.data.status,
    order: entry.data.order,
    scenarios: entry.data.scenarios,
    thumbnail: entry.data.thumbnail,
    entry,
  })).sort((a, b) => a.order - b.order);
}

export function relatedLogbookEntries(
  current: LogbookEntry,
  entries: LogbookEntry[],
  limit = 3,
): LogbookEntry[] {
  const scenarios = new Set(current.scenarios);
  return entries
    .filter((entry) => entry.slug !== current.slug)
    .map((entry) => {
      const sharedScenarios = entry.scenarios.filter((scenario) => scenarios.has(scenario)).length;
      const score =
        sharedScenarios * 100 +
        (entry.kind === current.kind ? 20 : 0) +
        (entry.section === current.section ? 10 : 0) -
        Math.abs(entry.order - current.order);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
