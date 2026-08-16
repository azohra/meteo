import type { ForecastHour, SiteForecast } from "../../contract.js";
import { msToKmh, p50, windToComponents } from "../../derive/index.js";
import { parcelAscent } from "../../derive/parcel.js";
import { windBarbParts, windBarbPaths } from "../../scene/barbs.js";
import { interpolateVertical, type FieldNode } from "../../scene/field.js";
import { short } from "../../scene/path.js";
import { bandOf, resolveHour, type Band, type ResolvedHour } from "../../scene/resolve.js";
import type { PressureAltitudeTick } from "../../scene/types.js";
import { M_TO_FT } from "../../scene/scene.js";
import {
  DEFAULT_SOUNDING_OVERLAYS,
  type SoundingAltitudeTick,
  type SoundingBarb,
  type SoundingMark,
  type SoundingOverlays,
  type SoundingScene,
  type SoundingSceneOptions,
  type SoundingTemperatureTick,
  type SoundingTrace,
  type SoundingTraceSample,
} from "./types.js";

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 560;
const MARGIN_LEFT = 62;
const PRESSURE_GUTTER = 40;
const BARB_GUTTER = 60;
const MARGIN_TOP = 20;
const AXIS_ROW = 34;
const NOTE_ROW = 16;
const TEMPERATURE_PAD_C = 2;

interface TraceBands {
  temperature: Band;
  dewPoint: Band;
}

function shortInstant(instant: string): string {
  return `${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Straight polyline through the samples — interpolation drawn as interpolation; never a curve. */
function straightPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${short(point.x)} ${short(point.y)}`)
    .join("");
}

/**
 * p25-p75 envelope polygon over the banded samples: straight edges up the
 * p75 side and back down the p25 side; runs split where a sample has no
 * band, and a run of one sample paints nothing.
 */
function envelopePath(
  samples: ReadonlyArray<{ y: number; band: Band; xOf: (valueC: number) => number }>,
): string | null {
  const parts: string[] = [];
  let run: Array<{ y: number; xLow: number; xHigh: number }> = [];
  const flush = () => {
    if (run.length >= 2) {
      const up = run.map((entry) => `${short(entry.xHigh)} ${short(entry.y)}`);
      const down = [...run].reverse().map((entry) => `${short(entry.xLow)} ${short(entry.y)}`);
      parts.push(`M${up.join("L")}L${down.join("L")}Z`);
    }
    run = [];
  };
  for (const sample of samples) {
    if (sample.band === null) flush();
    else {
      run.push({
        y: sample.y,
        xLow: sample.xOf(sample.band.p25),
        xHigh: sample.xOf(sample.band.p75),
      });
    }
  }
  flush();
  return parts.length > 0 ? parts.join("") : null;
}

/** The raw hour's per-level ensemble bands, keyed by the level's median height. */
function levelBandsByHeight(hour: ForecastHour): Map<number, TraceBands> {
  const byHeight = new Map<number, TraceBands>();
  for (const level of hour.levels) {
    const heightM = p50(level.heightM);
    if (heightM === null) continue;
    byHeight.set(heightM, {
      temperature: bandOf(level.temperatureC),
      dewPoint: bandOf(level.dewPointC),
    });
  }
  return byHeight;
}

/**
 * Builds the single-hour flyable-band sounding scene: pure serializable
 * data, no DOM. `options.validAt` selects the hour; an instant the profile
 * does not publish — or an hour whose required medians are absent —
 * returns null rather than throwing, and the scene echoes `validAt` so a
 * Meteogram selection can drive it.
 */
export function buildSoundingScene(
  profile: SiteForecast,
  options: SoundingSceneOptions,
): SoundingScene | null {
  const requestedMs = Date.parse(options.validAt);
  if (Number.isNaN(requestedMs)) return null;
  const hourIndex = profile.hours.findIndex((hour) => Date.parse(hour.validAt) === requestedMs);
  if (hourIndex === -1) return null;
  const hour = resolveHour(profile.hours[hourIndex]);
  if (hour === null) return null;

  const overlays: SoundingOverlays = { ...DEFAULT_SOUNDING_OVERLAYS, ...options.overlays };
  const floorM = options.floorM ?? profile.site.modelElevationM;
  const launchElevationM = options.launch?.elevationM ?? null;
  const allHours = profile.hours
    .map(resolveHour)
    .filter((entry): entry is ResolvedHour => entry !== null);

  // Altitude domain: the Meteogram's rules over the whole profile plus the
  // launch, so the axis matches a Meteogram of the same document and stays
  // put while a consumer scrubs hours.
  let topM = options.topM ?? Number.NaN;
  if (options.topM === undefined) {
    topM = Math.max(floorM + 800, overlays.launch ? (launchElevationM ?? floorM) : floorM);
    for (const entry of allHours) {
      for (const candidate of [
        overlays.cloudBase ? entry.derived.cloudBaseM : null,
        overlays.usableLiftTop ? entry.derived.usableLiftTopM : null,
        overlays.boundaryLayerTop ? entry.derived.boundaryLayerTopM : null,
        overlays.cloudBase ? entry.bands.cloudBaseM?.p75 : null,
        overlays.usableLiftTop ? entry.bands.usableLiftTopM?.p75 : null,
        overlays.boundaryLayerTop ? entry.bands.boundaryLayerTopM?.p75 : null,
      ]) {
        if (candidate != null && candidate > topM) topM = candidate;
      }
      for (const level of entry.levels) {
        if (level.heightM > topM) topM = level.heightM;
      }
    }
    topM *= 1.04;
  }

  const levels = hour.levels.filter((level) => level.heightM > floorM && level.heightM <= topM);
  const levelCount = levels.length;
  const bands = levelBandsByHeight(profile.hours[hourIndex]);
  const surfaceBands: TraceBands = {
    temperature: bandOf(profile.hours[hourIndex].surface.temperatureC),
    dewPoint: bandOf(profile.hours[hourIndex].surface.dewPointC),
  };

  const ascent =
    levels.length > 0
      ? parcelAscent(
          {
            temperatureC: hour.surface.temperatureC,
            dewPointC: hour.surface.dewPointC,
            elevationM: floorM,
          },
          levels,
        )
      : null;

  // Temperature domain across everything drawn, envelopes included.
  const domainValues: number[] = [];
  const pushBand = (band: Band) => {
    if (band !== null) domainValues.push(band.p25, band.p75);
  };
  if (overlays.temperature) {
    domainValues.push(hour.surface.temperatureC, ...levels.map((level) => level.temperatureC));
    pushBand(surfaceBands.temperature);
    for (const level of levels) pushBand(bands.get(level.heightM)?.temperature ?? null);
  }
  if (overlays.dewPoint) {
    domainValues.push(hour.surface.dewPointC, ...levels.map((level) => level.dewPointC));
    pushBand(surfaceBands.dewPoint);
    for (const level of levels) pushBand(bands.get(level.heightM)?.dewPoint ?? null);
  }
  if (overlays.parcel && ascent !== null) {
    domainValues.push(hour.surface.temperatureC, ...ascent.levels.map((s) => s.parcelTempC));
  }
  if (domainValues.length === 0) domainValues.push(hour.surface.temperatureC);
  const temperatureMinC = Math.floor((Math.min(...domainValues) - TEMPERATURE_PAD_C) / 5) * 5;
  const temperatureMaxC = Math.ceil((Math.max(...domainValues) + TEMPERATURE_PAD_C) / 5) * 5;

  const width = options.widthPx ?? DEFAULT_WIDTH;
  const height = options.heightPx ?? DEFAULT_HEIGHT;
  const plotLeft = MARGIN_LEFT;
  const plotTop = MARGIN_TOP;
  const plotWidth = Math.max(40, width - MARGIN_LEFT - PRESSURE_GUTTER - BARB_GUTTER);
  const plotHeight = Math.max(40, height - MARGIN_TOP - AXIS_ROW - NOTE_ROW);
  const barbX = plotLeft + plotWidth + PRESSURE_GUTTER + BARB_GUTTER / 2;

  const y = (altitudeM: number) =>
    plotTop + plotHeight * (1 - (altitudeM - floorM) / (topM - floorM));
  const x = (temperatureC: number) =>
    plotLeft + plotWidth * ((temperatureC - temperatureMinC) / (temperatureMaxC - temperatureMinC));

  const traces: SoundingTrace[] = [];
  // Traces can converge at the column top (saturation aloft), so each
  // label leaves the shared point in its own direction.
  const labelAt = (
    key: SoundingTrace["key"],
    top: { x: number; y: number },
    text: string,
  ): SoundingTrace["label"] => {
    if (key === "temperature") return { x: top.x + 7, y: top.y + 3.5, text, anchor: "start" };
    if (key === "dewPoint") return { x: top.x - 7, y: top.y + 3.5, text, anchor: "end" };
    return { x: top.x, y: top.y - 8, text, anchor: "middle" };
  };
  const traceOf = (
    key: SoundingTrace["key"],
    className: string,
    labelText: string,
    dash: string | null,
    strokeWidth: number,
    nodes: ReadonlyArray<{ altitudeM: number; valueC: number; surface: boolean; band: Band }>,
  ): SoundingTrace | null => {
    if (nodes.length === 0) return null;
    const samples: SoundingTraceSample[] = nodes.map((node) => ({
      altitudeM: node.altitudeM,
      valueC: node.valueC,
      x: x(node.valueC),
      y: y(node.altitudeM),
      surface: node.surface,
    }));
    const top = samples[samples.length - 1];
    return {
      key,
      className,
      samples,
      segmentPath: straightPath(samples),
      bandPath: envelopePath(
        nodes.map((node) => ({ y: y(node.altitudeM), band: node.band, xOf: x })),
      ),
      dash,
      strokeWidth,
      label: labelAt(key, top, labelText),
    };
  };

  if (overlays.temperature) {
    const trace = traceOf("temperature", "meteo-sounding-temp", "T", "4 3", 1.6, [
      {
        altitudeM: floorM,
        valueC: hour.surface.temperatureC,
        surface: true,
        band: surfaceBands.temperature,
      },
      ...levels.map((level) => ({
        altitudeM: level.heightM,
        valueC: level.temperatureC,
        surface: false,
        band: bands.get(level.heightM)?.temperature ?? null,
      })),
    ]);
    if (trace) traces.push(trace);
  }
  if (overlays.dewPoint) {
    const trace = traceOf("dewPoint", "meteo-sounding-dewpoint", "Td", "4 3", 1.6, [
      {
        altitudeM: floorM,
        valueC: hour.surface.dewPointC,
        surface: true,
        band: surfaceBands.dewPoint,
      },
      ...levels.map((level) => ({
        altitudeM: level.heightM,
        valueC: level.dewPointC,
        surface: false,
        band: bands.get(level.heightM)?.dewPoint ?? null,
      })),
    ]);
    if (trace) traces.push(trace);
  }
  const parcelNodes: FieldNode[] =
    ascent === null
      ? []
      : [
          { altitudeM: floorM, value: hour.surface.temperatureC },
          ...ascent.levels.map((sample) => ({
            altitudeM: sample.heightM,
            value: sample.parcelTempC,
          })),
        ];
  if (overlays.parcel && ascent !== null) {
    const trace = traceOf(
      "parcel",
      "meteo-sounding-parcel",
      "parcel",
      "7 3",
      1.8,
      parcelNodes.map((node, index) => ({
        altitudeM: node.altitudeM,
        valueC: node.value,
        surface: index === 0,
        band: null,
      })),
    );
    if (trace) traces.push(trace);
  }

  const lcl =
    overlays.parcel && ascent?.lclM != null && ascent.lclM >= floorM && ascent.lclM <= topM
      ? {
          x: x(interpolateVertical(parcelNodes, ascent.lclM) ?? hour.surface.temperatureC),
          y: y(ascent.lclM),
          altitudeM: ascent.lclM,
          label: `LCL ${Math.round(ascent.lclM)} m`,
        }
      : null;

  const marks: SoundingMark[] = [];
  const markOf = (
    key: SoundingMark["key"],
    className: string,
    label: string,
    dash: string | null,
    altitudeM: number | null,
    band: Band,
  ) => {
    if (altitudeM == null || altitudeM < floorM || altitudeM > topM) return;
    marks.push({
      key,
      className,
      y: y(altitudeM),
      altitudeM,
      label: `${label} ${Math.round(altitudeM)} m`,
      dash,
      band: band === null ? null : { yLow: y(band.p25), yHigh: y(band.p75) },
    });
  };
  if (overlays.boundaryLayerTop) {
    markOf(
      "boundaryLayerTop",
      "meteo-sounding-mark-boundary",
      "BL top",
      "10 5",
      hour.derived.boundaryLayerTopM,
      hour.bands.boundaryLayerTopM,
    );
  }
  if (overlays.cloudBase) {
    markOf(
      "cloudBase",
      "meteo-sounding-mark-cloud-base",
      "cloud base",
      "1 5",
      hour.derived.cloudBaseM,
      hour.bands.cloudBaseM,
    );
  }
  if (overlays.usableLiftTop) {
    markOf(
      "usableLiftTop",
      "meteo-sounding-mark-usable",
      "usable lift",
      null,
      hour.derived.usableLiftTopM,
      hour.bands.usableLiftTopM,
    );
  }
  if (overlays.launch) {
    markOf("launch", "meteo-sounding-mark-launch", "launch", "2 4", launchElevationM, null);
  }

  const barbs: SoundingBarb[] = [];
  if (overlays.wind) {
    const place = (altitudeM: number, speedMps: number, directionDeg: number, surface: boolean) => {
      const speedKmh = msToKmh(speedMps);
      const paths = windBarbPaths(speedKmh);
      barbs.push({
        y: y(altitudeM),
        altitudeM,
        directionDeg,
        speedKmh,
        calm: windBarbParts(speedKmh).calm,
        shaftPath: paths.shaft,
        pennantPaths: paths.pennants,
        surface,
      });
    };
    place(floorM, hour.surface.windSpeedMps, hour.surface.windDirectionDeg, true);
    for (const level of levels) {
      place(level.heightM, level.windSpeedMps, level.windDirectionDeg, false);
    }
  }

  const altitudeTicks: SoundingAltitudeTick[] = [];
  for (let tick = 0; tick <= 5; tick += 1) {
    const altitudeM = floorM + ((topM - floorM) * tick) / 5;
    altitudeTicks.push({
      altitudeM,
      y: y(altitudeM),
      labelMetres: `${Math.round(altitudeM)}m`,
      labelFeet: `${Math.round(altitudeM * M_TO_FT)}ft`,
    });
  }

  // Pressure ticks: median published height per isobaric level across the
  // whole profile — the Meteogram's convention — so they stay put across
  // hour selections even where this hour's own level heights differ.
  const byPressure = new Map<number, number[]>();
  for (const entry of allHours) {
    for (const level of entry.levels) {
      const heights = byPressure.get(level.pressureHpa) ?? [];
      heights.push(level.heightM);
      byPressure.set(level.pressureHpa, heights);
    }
  }
  const pressureAltitude: PressureAltitudeTick[] = [
    { altitudeM: Math.round(floorM), pressureHpa: null as number | null },
    ...[...byPressure.entries()].map(([pressureHpa, heights]) => ({
      altitudeM: Math.round(median(heights)),
      pressureHpa: pressureHpa as number | null,
    })),
  ]
    .filter((entry) => entry.altitudeM >= floorM && entry.altitudeM <= topM)
    .sort((left, right) => left.altitudeM - right.altitudeM)
    .filter(
      (entry, index, entries) =>
        index === 0 || entry.altitudeM - entries[index - 1].altitudeM >= 80,
    )
    .map((entry) => ({ ...entry, y: y(entry.altitudeM) }));

  const temperatureStep = temperatureMaxC - temperatureMinC > 45 ? 10 : 5;
  const temperatureTicks: SoundingTemperatureTick[] = [];
  for (let t = temperatureMinC; t <= temperatureMaxC; t += temperatureStep) {
    temperatureTicks.push({ temperatureC: t, x: x(t), label: `${t}°` });
  }

  const columnTopM = levels.length > 0 ? levels[levels.length - 1].heightM : floorM;
  const capNote =
    levels.length > 0
      ? `flyable-band profile · ${levelCount} published levels · column ends at ${Math.round(columnTopM)} m`
      : "flyable-band profile · no published levels this hour — surface only";

  const surfaceWind = windToComponents(hour.surface.windSpeedMps, hour.surface.windDirectionDeg);
  const levelWinds = levels.map((level) =>
    windToComponents(level.windSpeedMps, level.windDirectionDeg),
  );

  return {
    width,
    height,
    ariaLabel:
      `Sounding for ${profile.site.name}, model ${profile.model}, ${shortInstant(hour.validAt)}: ` +
      "temperature, dew point, and a lifted parcel over the flyable band, with a wind-barb ladder " +
      "and derived-height marks. Dots are the model's published levels; the profile ends at the " +
      "published column top — this is not a full skew-T.",
    validAt: hour.validAt,
    scales: {
      plotLeft,
      plotTop,
      plotWidth,
      plotHeight,
      floorM,
      topM,
      temperatureMinC,
      temperatureMaxC,
      barbX,
    },
    axes: { altitude: altitudeTicks, pressureAltitude, temperature: temperatureTicks },
    traces,
    marks,
    barbs,
    lcl,
    levelCount,
    capNote,
    sampling: {
      temperatureC: [
        { altitudeM: floorM, value: hour.surface.temperatureC },
        ...levels.map((level) => ({ altitudeM: level.heightM, value: level.temperatureC })),
      ],
      dewPointC: [
        { altitudeM: floorM, value: hour.surface.dewPointC },
        ...levels.map((level) => ({ altitudeM: level.heightM, value: level.dewPointC })),
      ],
      windU: [
        { altitudeM: floorM, value: surfaceWind.uMps },
        ...levels.map((level, index) => ({
          altitudeM: level.heightM,
          value: levelWinds[index].uMps,
        })),
      ],
      windV: [
        { altitudeM: floorM, value: surfaceWind.vMps },
        ...levels.map((level, index) => ({
          altitudeM: level.heightM,
          value: levelWinds[index].vMps,
        })),
      ],
      parcelTempC: parcelNodes,
      buoyancyC:
        ascent === null
          ? []
          : ascent.levels.map((sample) => ({
              altitudeM: sample.heightM,
              value: sample.buoyancyC,
            })),
    },
  };
}
