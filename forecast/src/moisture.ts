export function dewPointDepression(temperatureC: number, rhPercent: number): number {
  const rh = Math.min(100.0, Math.max(1.0, rhPercent));
  const gamma = Math.log(rh / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  const dewPointC = (243.04 * gamma) / (17.625 - gamma);
  return temperatureC - dewPointC;
}
