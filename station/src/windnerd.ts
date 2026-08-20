const WINDNERD_HOST = "windnerd.net";
const WINDNERD_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* The vendor's full record catalogue, verified against the live API
 * 2026-08-19: every other value (2, 3, 120, 240, 720, 1440 probed) returns
 * 404. Client-safe home — the server adapter validates against it and the
 * client archive pager defaults to it. */
export const WINDNERD_RECORD_PERIODS_MINUTES = [1, 5, 10, 15, 30, 60, 180, 360] as const;
export type WindnerdRecordPeriodMinutes = (typeof WINDNERD_RECORD_PERIODS_MINUTES)[number];

export function normalizeWindnerdStationKey(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (WINDNERD_KEY.test(candidate)) return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== WINDNERD_HOST) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const key = segments[1];
  if (segments.length !== 2 || segments[0] !== "en" || !key || !WINDNERD_KEY.test(key)) {
    return null;
  }
  return key;
}

export function windnerdStationUrl(stationKey: string): string {
  if (!WINDNERD_KEY.test(stationKey)) {
    throw new Error("Invalid WindNerd station key.");
  }
  return `https://${WINDNERD_HOST}/en/${stationKey}`;
}
