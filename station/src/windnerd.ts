const WINDNERD_HOST = "windnerd.net";
const WINDNERD_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
