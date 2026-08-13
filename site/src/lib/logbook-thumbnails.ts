import type { LogbookEntry } from "./logbook";

export type LogbookThumbnailKind = LogbookEntry["thumbnail"];

export interface LogbookThumbnailModel {
  number: string;
  title: string;
  section: string;
  kind: LogbookEntry["kind"];
  status: LogbookEntry["status"];
  accent: LogbookEntry["accent"];
  visual: LogbookThumbnailKind;
}

type ThumbnailEntry = Pick<
  LogbookEntry,
  "number" | "title" | "section" | "kind" | "status" | "accent" | "thumbnail"
>;

export function logbookThumbnailFor(entry: ThumbnailEntry): LogbookThumbnailModel {
  return {
    number: entry.number,
    title: entry.title,
    section: entry.section,
    kind: entry.kind,
    status: entry.status,
    accent: entry.accent,
    visual: entry.thumbnail,
  };
}
