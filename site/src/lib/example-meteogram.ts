import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { groupByLocalDay } from "@azohra/meteo.briefing/derive";
import {
  buildMeteogramScene,
  DEFAULT_OVERLAYS,
  meteogramDisplayHours,
  renderMeteogramSvg,
  type OverlayName,
  type MeteogramScene,
  type MeteogramOptions,
} from "@azohra/meteo.briefing/meteogram";

export interface SyntheticScenarioSource {
  id: string;
  variant?: string;
  profile: SiteForecast;
  timeZone: string;
  launch?: { name?: string; elevationM: number };
}

export interface SyntheticMeteogramOptions extends Omit<MeteogramOptions, "timeZone" | "hours"> {
  displayDay?: boolean;
}

export type InteractiveSyntheticMeteogramOptions = Pick<
  SyntheticMeteogramOptions,
  | "overlays"
  | "columnWidthPx"
  | "widthPx"
  | "plotHeightPx"
  | "barbStride"
  | "barbMinGapPx"
  | "barbScale"
  | "markerStride"
  | "stripLabels"
  | "displayDay"
> & {
  hourLabel?: "24h" | "12h";
};

const DEFAULT_COLUMN_WIDTH_PX = 72;
const DEFAULT_PLOT_HEIGHT_PX = 390;

function displayHours(scenario: SyntheticScenarioSource) {
  const windowed = meteogramDisplayHours(scenario.profile.hours, {
    timeZone: scenario.timeZone,
  });
  const days = groupByLocalDay(windowed, scenario.timeZone);
  return [...days].sort((left, right) => right.hours.length - left.hours.length)[0]?.hours ?? [];
}

export function renderSyntheticMeteogram(
  scenario: SyntheticScenarioSource,
  options: SyntheticMeteogramOptions = {},
  idPrefix = `synthetic-${scenario.id}${scenario.variant ? `-${scenario.variant}` : ""}`,
): { scene: MeteogramScene; svg: string } {
  const { displayDay = false, ...sceneOptions } = options;
  const scene = buildMeteogramScene(scenario.profile, {
    timeZone: scenario.timeZone,
    columnWidthPx: DEFAULT_COLUMN_WIDTH_PX,
    plotHeightPx: DEFAULT_PLOT_HEIGHT_PX,
    ...(scenario.launch ? { launch: scenario.launch } : {}),
    ...(displayDay ? { hours: displayHours(scenario) } : {}),
    ...sceneOptions,
  });
  return { scene, svg: renderMeteogramSvg(scene, { idPrefix }) };
}

export function onlyOverlays(...enabled: OverlayName[]): Record<OverlayName, boolean> {
  const selected = new Set(enabled);
  return Object.fromEntries(
    Object.keys(DEFAULT_OVERLAYS).map((name) => [name, selected.has(name as OverlayName)]),
  ) as Record<OverlayName, boolean>;
}

export function overlayAvailability(
  scenario: SyntheticScenarioSource,
): Record<OverlayName, boolean> {
  const everything = Object.fromEntries(
    Object.keys(DEFAULT_OVERLAYS).map((name) => [name, true]),
  ) as Record<OverlayName, boolean>;
  const { scene } = renderSyntheticMeteogram(scenario, { overlays: everything });
  const strips = new Set(scene.strips.map((strip) => strip.key));
  const fields = new Set(scene.fields.map((field) => field.key));
  const series = new Set(scene.series.map((entry) => entry.key));
  return {
    temperature: series.has("isotherm"),
    wind: scene.barbs.length > 0,
    clouds: fields.has("clouds") || strips.has("cloudCover"),
    thermalStrength: strips.has("thermalStrength"),
    stability: fields.has("stability"),
    thermalIndex: fields.has("thermalIndex"),
    windShear: fields.has("windShear"),
    buoyancyShear: strips.has("buoyancyShear"),
    dewPoint: series.has("dewPointIsoline"),
    relativeHumidity: fields.has("relativeHumidity"),
    verticalVelocity: fields.has("verticalVelocity"),
    cape: strips.has("cape"),
    gusts: scene.gusts.length > 0,
    pblHeight: series.has("modelPblTop"),
    cloudLayers: strips.has("cloudLayers"),
    smoke: strips.has("smoke"),
    observedIrradiance: strips.has("observedIrradiance"),
    observedAot: strips.has("observedAot"),
    pressure: strips.has("pressure"),
    precipitation: strips.has("precipitation"),
    boundaryLayerTop: series.has("boundaryLayerTop"),
    cloudBase: series.has("cloudBase"),
    usableLiftTop: series.has("usableLiftTop"),
    launch: scene.launch !== null,
    selectedHour: scene.scales.hourCount > 0,
    surfaceTemperature: scene.surfaceTemperatures.length > 0,
  };
}
