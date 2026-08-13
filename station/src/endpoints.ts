const trimBase = (base: string) => base.replace(/\/+$/, "");

export function feedEndpoint(base: string): string {
  return `${trimBase(base)}/feed`;
}

export function currentEndpoint(base: string, stationId: string): string {
  return `${trimBase(base)}/current?station=${encodeURIComponent(stationId)}`;
}
