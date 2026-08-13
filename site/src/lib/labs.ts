import { isEnsembleValue, type SiteForecast } from "@azohra/meteo.briefing/contract";
import {
  componentsToWind,
  p50,
  SMOKE_MASS_EXTINCTION_M2_PER_G,
  smokeAdjustedThermalVelocityMps,
  smokeTransmittance,
  usableLiftTopM,
  vectorShearMps,
} from "@azohra/meteo.briefing/derive";
import {
  buildMeteogramScene,
  interpolateVertical,
  renderMeteogramSvg,
  type MeteogramScene,
} from "@azohra/meteo.briefing/meteogram";
import { onlyOverlays } from "./example-meteogram";

export interface LabScenarioSource {
  profile: SiteForecast;
  timeZone: string;
  launch?: { name?: string; elevationM: number };
}

const launchOption = (source: LabScenarioSource) =>
  source.launch ? { launch: source.launch } : {};

export const utcHourLabel = (validAt: string): string => `${validAt.slice(11, 16)} UTC`;

export const formatHeightM = (value: number | null): string =>
  value === null ? "none" : `${Math.round(value)} m`;

export const formatThermalMps = (value: number | null): string =>
  value === null ? "none" : `${value.toFixed(2)} m/s`;

const USABLE_LIFT_OVERLAYS = onlyOverlays(
  "boundaryLayerTop",
  "cloudBase",
  "usableLiftTop",
  "launch",
  "selectedHour",
);

function usableLiftTops(profile: SiteForecast, sinkRateMps: number): Array<number | null> {
  return profile.hours.map((hour) => {
    const boundaryLayerTopM = p50(hour.derived.boundaryLayerTopM);
    const thermalVelocityMps = p50(hour.derived.thermalVelocityMps);
    const cloudBaseM = p50(hour.derived.cloudBaseM);
    const levelHeights = hour.levels.map((level) => p50(level.heightM));
    const heights = levelHeights.filter((height): height is number => height !== null);
    if (
      boundaryLayerTopM === null ||
      thermalVelocityMps === null ||
      cloudBaseM === null ||
      heights.length !== levelHeights.length
    )
      return null;
    return usableLiftTopM(
      {
        modelElevationM: profile.site.modelElevationM,
        boundaryLayerTopM,
        thermalVelocityMps,
        cloudBaseM,
        levels: heights.map((heightM) => ({ heightM })),
      },
      sinkRateMps,
    );
  });
}

export function usableLiftSummary(
  profile: SiteForecast,
  sinkRateMps: number,
): { derivedCount: number; hourCount: number; peakM: number | null } {
  const values = usableLiftTops(profile, sinkRateMps);
  const available = values.filter((value): value is number => value !== null);
  return {
    derivedCount: available.length,
    hourCount: values.length,
    peakM: available.length === 0 ? null : Math.max(...available),
  };
}

export function renderUsableLiftChart(
  source: LabScenarioSource,
  sinkRateMps: number,
): { scene: MeteogramScene; svg: string } {
  const scene = buildMeteogramScene(source.profile, {
    timeZone: source.timeZone,
    ...launchOption(source),
    overlays: USABLE_LIFT_OVERLAYS,
    sinkRateMps,
    smooth: false,
    columnWidthPx: 74,
    plotHeightPx: 330,
  });
  return { scene, svg: renderMeteogramSvg(scene, { idPrefix: "usable-lift-lab" }) };
}

const ENSEMBLE_SPREAD_OVERLAYS = onlyOverlays(
  "boundaryLayerTop",
  "cloudBase",
  "usableLiftTop",
  "selectedHour",
);

export function ensembleSpreadSummary(profile: SiteForecast): {
  maxIqrM: number | null;
  ceiledMembers: number;
  members: number;
} {
  const usable = profile.hours
    .map((hour) => hour.derived.usableLiftTopM)
    .filter(
      (value) =>
        value !== null && isEnsembleValue(value) && value.p25 !== null && value.p75 !== null,
    );
  const maxIqrM =
    usable.length === 0 ? null : Math.max(...usable.map((value) => value.p75 - value.p25));
  const ceiledMembers = Math.max(
    0,
    ...profile.hours.map((hour) => {
      const value = hour.derived.boundaryLayerTopM;
      return value !== null && isEnsembleValue(value) ? (value.ceiledMembers ?? 0) : 0;
    }),
  );
  return { maxIqrM, ceiledMembers, members: profile.run.members ?? 1 };
}

export function renderEnsembleSpreadChart(
  source: LabScenarioSource,
  key: string,
): { scene: MeteogramScene; svg: string } {
  const scene = buildMeteogramScene(source.profile, {
    timeZone: source.timeZone,
    ...launchOption(source),
    overlays: ENSEMBLE_SPREAD_OVERLAYS,
    smooth: false,
    columnWidthPx: 74,
    plotHeightPx: 350,
  });
  return { scene, svg: renderMeteogramSvg(scene, { idPrefix: `ensemble-spread-lab-${key}` }) };
}

const PARCEL_OVERLAYS = onlyOverlays(
  "stability",
  "thermalIndex",
  "boundaryLayerTop",
  "launch",
  "selectedHour",
);

export function renderParcelChart(
  source: LabScenarioSource,
  key: string,
  hourCount: number,
): { scene: MeteogramScene; svg: string } {
  const scene = buildMeteogramScene(source.profile, {
    timeZone: source.timeZone,
    ...launchOption(source),
    hourIndices: source.profile.hours.slice(0, hourCount).map((_, index) => index),
    overlays: PARCEL_OVERLAYS,
    smooth: false,
    columnWidthPx: 74,
    plotHeightPx: 330,
  });
  return { scene, svg: renderMeteogramSvg(scene, { idPrefix: `parcel-lab-${key}` }) };
}

const WIND_SHEAR_OVERLAYS = onlyOverlays(
  "wind",
  "windShear",
  "usableLiftTop",
  "launch",
  "selectedHour",
);

export const windLabel = (wind: { speedMps: number; directionDeg: number } | null): string =>
  wind ? `${wind.speedMps.toFixed(1)} m/s from ${Math.round(wind.directionDeg)}°` : "not available";

function readWind(scene: MeteogramScene, altitudeM: number) {
  const sampling = scene.sampling[0];
  const uMps = interpolateVertical(sampling.windU, altitudeM);
  const vMps = interpolateVertical(sampling.windV, altitudeM);
  return uMps === null || vMps === null ? null : componentsToWind(uMps, vMps);
}

export interface WindShearFrame {
  scene: MeteogramScene;
  svg: string;
  launchWind: { speedMps: number; directionDeg: number } | null;
  usableWind: { speedMps: number; directionDeg: number } | null;
  shearMps: number | null;
}

export function windShearFrame(source: LabScenarioSource, hourIndex: number): WindShearFrame {
  const profile = source.profile;
  const hour = profile.hours[hourIndex];
  const scene = buildMeteogramScene(profile, {
    timeZone: source.timeZone,
    ...launchOption(source),
    hourIndices: [hourIndex],
    overlays: WIND_SHEAR_OVERLAYS,
    smooth: false,
    widthPx: 400,
    plotHeightPx: 390,
  });
  const launchAltitudeM = source.launch?.elevationM ?? profile.site.modelElevationM;
  const usableAltitudeM = p50(hour.derived.usableLiftTopM);
  const launchWind = readWind(scene, launchAltitudeM);
  const usableWind = usableAltitudeM === null ? null : readWind(scene, usableAltitudeM);
  const shearMps =
    launchWind && usableWind
      ? vectorShearMps(
          { windSpeedMps: launchWind.speedMps, windDirectionDeg: launchWind.directionDeg },
          { windSpeedMps: usableWind.speedMps, windDirectionDeg: usableWind.directionDeg },
        )
      : null;
  return {
    scene,
    svg: renderMeteogramSvg(scene, { idPrefix: "wind-shear-lab" }),
    launchWind,
    usableWind,
    shearMps,
  };
}

export const TIMING_OVERLAYS = onlyOverlays(
  "thermalStrength",
  "boundaryLayerTop",
  "usableLiftTop",
  "launch",
  "selectedHour",
);

export function timingHourValues(
  profile: SiteForecast,
  index: number,
): {
  thermalVelocityMps: number | null;
  boundaryLayerTopM: number | null;
  usableLiftTopM: number | null;
} {
  const hour = profile.hours[index];
  return {
    thermalVelocityMps: p50(hour.derived.thermalVelocityMps),
    boundaryLayerTopM: p50(hour.derived.boundaryLayerTopM),
    usableLiftTopM: p50(hour.derived.usableLiftTopM),
  };
}

const SMOKE_LAB_OVERLAYS = onlyOverlays(
  "smoke",
  "thermalStrength",
  "boundaryLayerTop",
  "cloudBase",
  "usableLiftTop",
  "selectedHour",
);
const SMOKE_LAB_MIXING_DEPTH_KM = 2;

export function uniformSmokeProfile(profile: SiteForecast, aot: number): SiteForecast {
  const columnMgm2 = (aot / SMOKE_MASS_EXTINCTION_M2_PER_G) * 1000;
  return {
    ...profile,
    hours: profile.hours.map((hour) => ({
      ...hour,
      smoke: {
        aot,
        columnMgm2,
        surfaceUgm3: columnMgm2 / SMOKE_LAB_MIXING_DEPTH_KM,
      },
    })),
  };
}

export function smokeLabSummary(
  profile: SiteForecast,
  aot: number,
): { transmittancePercent: number; wStarKeptPercent: number; peakAdjustedMps: number } {
  const transmittance = smokeTransmittance(aot);
  let peakAdjustedMps = 0;
  for (const hour of profile.hours) {
    const wStar = hour.derived.thermalVelocityMps;
    const value = isEnsembleValue(wStar) ? (wStar.p50 ?? 0) : wStar;
    peakAdjustedMps = Math.max(
      peakAdjustedMps,
      smokeAdjustedThermalVelocityMps(value, transmittance),
    );
  }
  return {
    transmittancePercent: transmittance * 100,
    wStarKeptPercent: Math.cbrt(transmittance) * 100,
    peakAdjustedMps,
  };
}

export function renderSmokeLabChart(
  source: LabScenarioSource,
  aot: number,
): { scene: MeteogramScene; svg: string } {
  const scene = buildMeteogramScene(uniformSmokeProfile(source.profile, aot), {
    timeZone: source.timeZone,
    ...launchOption(source),
    overlays: SMOKE_LAB_OVERLAYS,
    smokeAdjusted: true,
    smooth: false,
    columnWidthPx: 74,
    plotHeightPx: 330,
  });
  return { scene, svg: renderMeteogramSvg(scene, { idPrefix: "smoke-lab" }) };
}
