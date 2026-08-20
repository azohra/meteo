import type { ForecastHour } from "../../contract.js";
import { p50 } from "../../derive/ensemble.js";
import { vectorShearMps } from "../../derive/shear.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { round1, round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * Strongest layer-shear rate inside the climb band per thermalWindow day:
 * vector shear between adjacent published levels over layer thickness.
 * Deterministic documents only. Rates are not comparable across level
 * densities (hence mandatory levelsInBand and layer bounds); absence means
 * "column too sparse to state", never "no shear".
 */
export interface BandShearFinding {
  kind: "bandShear";
  day: LocalDayKey;
  maxShear: {
    /** m/s per km — the layer-normalized number. */
    ratePerKm: number;
    /** The raw vector wind difference across the layer, stated beside the rate so the normalization hides nothing. */
    shearMps: number;
    /** Mandatory — the rate means nothing without its layer. */
    layer: { fromM: number; toM: number; thicknessM: number };
    at: CitedInstant;
    lower: { speedMps: number; directionDeg: number; heightM: number };
    upper: { speedMps: number; directionDeg: number; heightM: number };
  };
  /** In-band published levels at the cited hour — the sparsity confession a cross-document reader must read before the rate. */
  levelsInBand: number;
  /** Both endpoint speeds sit under `endpointFloorMps` — an arithmetic relation, not a verdict; a light-wind direction difference can manufacture a rate. */
  bothEndpointsUnderFloorMps: boolean;
  thresholds: { minLayerThicknessM: number; endpointFloorMps: number };
  /** Per window-scope hour: the hour's own max layer rate (null where the hour has no lift top or fewer than two in-band levels). */
  evidence: { hours: string[]; maxRatePerKm: (number | null)[] };
}

interface LayerMax {
  ratePerKm: number;
  shearMps: number;
  lower: { speedMps: number; directionDeg: number; heightM: number };
  upper: { speedMps: number; directionDeg: number; heightM: number };
  levelsInBand: number;
}

export function findBandShear(
  context: Context,
  windows: ThermalWindowFinding[],
): BandShearFinding[] {
  if (!context.deterministic) return [];
  const { profile, launchReferenceM, thresholds } = context;
  const { minLayerThicknessM, endpointFloorMps } = thresholds.bandShear;
  const hourByValidAt = new Map(profile.hours.map((hour) => [hour.validAt, hour]));

  const windowHoursByDay = new Map<string, string[]>();
  for (const window of windows) {
    const bucket = windowHoursByDay.get(window.day) ?? [];
    bucket.push(...window.evidence.hours);
    windowHoursByDay.set(window.day, bucket);
  }

  const hourMax = (hour: ForecastHour): LayerMax | null => {
    const top = p50(hour.derived.usableLiftTopM);
    if (top === null) return null;
    const inBand = hour.levels
      .flatMap((level) => {
        const heightM = p50(level.heightM);
        const speedMps = p50(level.windSpeedMps);
        const directionDeg = p50(level.windDirectionDeg);
        if (heightM === null || speedMps === null || directionDeg === null) return [];
        if (heightM < launchReferenceM || heightM > top) return [];
        return [{ heightM, speedMps, directionDeg }];
      })
      .sort((left, right) => left.heightM - right.heightM);
    let best: LayerMax | null = null;
    for (let i = 0; i + 1 < inBand.length; i += 1) {
      const lower = inBand[i];
      const upper = inBand[i + 1];
      const thicknessM = upper.heightM - lower.heightM;
      if (thicknessM < minLayerThicknessM) continue;
      const shearMps = vectorShearMps(
        { windSpeedMps: lower.speedMps, windDirectionDeg: lower.directionDeg },
        { windSpeedMps: upper.speedMps, windDirectionDeg: upper.directionDeg },
      );
      const ratePerKm = shearMps / (thicknessM / 1000);
      if (best === null || ratePerKm > best.ratePerKm) {
        best = { ratePerKm, shearMps, lower, upper, levelsInBand: inBand.length };
      }
    }
    return best;
  };

  const findings: BandShearFinding[] = [];
  for (const [day, windowHours] of windowHoursByDay) {
    const maxima = windowHours.map((validAt) => ({
      validAt,
      max: hourMax(hourByValidAt.get(validAt)!),
    }));
    const peak = maxima.reduce(
      (best: (typeof maxima)[number] | null, entry) =>
        entry.max !== null && (best === null || entry.max.ratePerKm > best.max!.ratePerKm)
          ? entry
          : best,
      null,
    );
    if (peak === null) continue;

    const { max } = peak;
    findings.push({
      kind: "bandShear",
      day,
      maxShear: {
        ratePerKm: round2(max!.ratePerKm),
        shearMps: round2(max!.shearMps),
        layer: {
          fromM: round1(max!.lower.heightM),
          toM: round1(max!.upper.heightM),
          thicknessM: round1(max!.upper.heightM - max!.lower.heightM),
        },
        at: context.cite(peak.validAt),
        lower: {
          speedMps: round2(max!.lower.speedMps),
          directionDeg: Math.round(max!.lower.directionDeg),
          heightM: round1(max!.lower.heightM),
        },
        upper: {
          speedMps: round2(max!.upper.speedMps),
          directionDeg: Math.round(max!.upper.directionDeg),
          heightM: round1(max!.upper.heightM),
        },
      },
      levelsInBand: max!.levelsInBand,
      bothEndpointsUnderFloorMps:
        max!.lower.speedMps < endpointFloorMps && max!.upper.speedMps < endpointFloorMps,
      thresholds: { minLayerThicknessM, endpointFloorMps },
      evidence: {
        hours: [...windowHours],
        maxRatePerKm: maxima.map((entry) =>
          entry.max === null ? null : round2(entry.max.ratePerKm),
        ),
      },
    });
  }
  return findings;
}
