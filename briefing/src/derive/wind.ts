import { KMH_PER_MPS } from "@azohra/meteo.core";

export {
  componentsToWind,
  normalizeDegrees,
  windToComponents,
  type WindComponents,
} from "@azohra/meteo.core";

/** m/s → km/h — the unit conversion behind every km/h readout. */
export function msToKmh(speedMps: number): number {
  return speedMps * KMH_PER_MPS;
}
