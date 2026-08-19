const trimBase = (base: string) => base.replace(/\/+$/, "");

export function feedEndpoint(base: string): string {
  return `${trimBase(base)}/feed`;
}

export function currentEndpoint(base: string, stationId: string): string {
  return `${trimBase(base)}/current?station=${encodeURIComponent(stationId)}`;
}

export function liveEndpoint(base: string, stationId: string): string {
  return `${trimBase(base)}/live?station=${encodeURIComponent(stationId)}`;
}

export function climatologyEndpoint(base: string, stationId: string): string {
  return `${trimBase(base)}/climatology?station=${encodeURIComponent(stationId)}`;
}

export function historyEndpoint(
  base: string,
  stationId: string,
  query: { fromMs: number; toMs: number; periodMinutes: number },
): string {
  const params = new URLSearchParams({
    station: stationId,
    from: new Date(query.fromMs).toISOString(),
    to: new Date(query.toMs).toISOString(),
    period: String(query.periodMinutes),
  });
  return `${trimBase(base)}/history?${params.toString()}`;
}
