import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import { KELVIN } from "./common.js";
import { allHours, modelSemantics, oldStylePressureVariable, type DatamartModel } from "./eccc.js";

export const SLUG = "hrdps-west";
// The alpha Datamart is not mirrored on hpfx: METEO_DATAMART_BASE must
// leave this feed on dd.alpha.
export const BASE_URL = "https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2";

type Convert = (value: number) => number;

export const SURFACE_FIELDS: Record<string, readonly [variable: string, convert: Convert]> = {
  cloudCoverPercent: ["TCDC_SFC_0", (v) => v],
  dewPointDepressionC: ["DEPR_TGL_2", (v) => v],
  latentHeatFluxWm2: ["LHTFL_SFC_0", (v) => v],
  precipitationMm: ["PRATE_SFC_0", (v) => v * 3600],
  seaLevelPressureHpa: ["PRMSL_MSL_0", (v) => v / 100.0],
  sensibleHeatFluxWm2: ["SHTFL_SFC_0", (v) => v],
  temperatureC: ["TMP_TGL_2", (v) => v - KELVIN],
  windDirectionDeg: ["WDIR_TGL_10", (v) => v],
  windSpeedMps: ["WIND_TGL_10", (v) => v],
};
export const PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;
export const TERRAIN_VARIABLE = "HGT_SFC_0";

// CAPE_ETAL_10000 departs eta = 1.0, i.e. surface-based.
export const GUST_MAX_VARIABLE = "GUST_MAX_TGL_10";
export const GUST_INSTANT_VARIABLE = "GUST_TGL_10";
export const CAPE_VARIABLE = "CAPE_ETAL_10000";
export const CAPE_SENTINEL = -1.0;
export const PBL_VARIABLE = "HPBL_SFC_0";

export function fileUrl(
  variable: string,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const step = String(forecastHour).padStart(3, "0");
  const name = `CMC_hrdps_west_${variable}_rotated_latlon0.009x0.009_${date}T${runHour}Z_P${step}-00.grib2`;
  return `${BASE_URL}/${runHour}/${step}/${name}`;
}

export const HRDPS_WEST: DatamartModel = {
  slug: SLUG,
  label: "HRDPS 1 km",
  publishedNoun: "HRDPS 1 km profiles",
  fileUrl: (date, runHour, forecastHour, variable) =>
    fileUrl(variable, date, runHour, forecastHour),
  runHours: ["12", "00"],
  forecastHours: Array.from({ length: 48 }, (_, index) => index + 1),
  probeVariable: "TMP_TGL_2",
  // DEPR is published directly at 2 m and on levels — no T/Td pair.
  surfaceVariables: SURFACE_FIELDS,
  pressureVariable: oldStylePressureVariable,
  omegaLevels: [], // no VVEL on the 1 km feed
  terrainVariable: TERRAIN_VARIABLE,
  // The alpha tree has no hour-0 directory; terrain rides the first slot.
  terrainHour: "firstSlot",
  levelsForHour: () => PRESSURE_LEVELS,
  // Every level publishes every hour; a missing level file is a broken run.
  missingLevelFileFatal: true,
  gustMaxVariable: GUST_MAX_VARIABLE,
  gustInstantVariable: GUST_INSTANT_VARIABLE,
  capeVariable: CAPE_VARIABLE,
  capeSentinel: CAPE_SENTINEL,
  capeForHour: allHours,
  pblVariable: PBL_VARIABLE,
};

export const SEMANTICS: ForecastSemantics = modelSemantics(HRDPS_WEST);
