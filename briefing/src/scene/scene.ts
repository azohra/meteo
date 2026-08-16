import { type ObservationDocument, type SiteForecast } from "../contract.js";
import {
  cosSolarZenith,
  dewPointDepressionC,
  isSmokeAwareProfile,
  lapseRateCPer1000Ft,
  msToKmh,
  nearestObservation,
  observedTransmittance,
  p50,
  relativeHumidityPercent,
  smokeAdjustedThermalVelocityMps,
  smokeHoursByValidAt,
  smokeTransmittance,
  surfaceLapseCPer1000Ft,
  thermalIndexC,
  usableLiftTopM,
  vectorShearMps,
  windToComponents,
  STABILITY_CLASSES,
} from "../derive/index.js";
import { smooth121 } from "./smoothing.js";
import { BARB_GLYPH_HEIGHT, BARB_GLYPH_RADIUS, windBarbParts, windBarbPaths } from "./barbs.js";
import { resolveSelection } from "./hit-test.js";
import { sampledFieldPaths, type FieldBanding, type FieldNode } from "./field.js";
import { bandPath, pointPath } from "./path.js";
import { resolveHour, resolveHourIndices, type Band, type ResolvedHour } from "./resolve.js";
import {
  METRIC_TOP,
  STRIP_DIVIDER_LABEL,
  buildStripSpecs,
  layoutStrips,
  stripStackGeometry,
  type StripGeometry,
} from "./strips.js";
import {
  DEFAULT_CAPE_CLASSES,
  DEFAULT_OVERLAYS,
  type AltitudeTick,
  type BarbPlacement,
  type FieldLayer,
  type GustMark,
  type HourSampling,
  type HourTick,
  type OverlayName,
  type PressureAltitudeTick,
  type MeteogramScene,
  type SceneLabel,
  type SceneMarker,
  type MeteogramOptions,
  type SeriesElement,
  type SurfaceTemperatureMark,
} from "./types.js";

const PROFILE_GAP = 8;
const MARGIN_LEFT = 60;
const MARGIN_RIGHT = 60;
const DEFAULT_COLUMN_WIDTH = 44;
const DEFAULT_PLOT_HEIGHT = 340;
const HOUR_LABEL_DY = 18;
const BOTTOM_PADDING = 14;
const SURFACE_TEMP_ROW_PX = 14;
const BARB_SCALE_MIN = 0.85;
const BARB_SCALE_MIN_COLUMN = DEFAULT_COLUMN_WIDTH;
const BARB_SCALE_MAX_COLUMN = 66;
const BARB_MIN_GAP_PX = 24;
export const M_TO_FT = 3.28084;

function shortInstant(instant: string): string {
  const date = instant.slice(0, 10);
  const hh = instant.slice(11, 13);
  const mm = instant.slice(14, 16);
  return mm === "00" ? `${date} ${hh}Z` : `${date} ${hh}:${mm}Z`;
}

/** TRIAL default for `measurementGapMinutes`: two 10-minute scan cadences plus slack, so consecutive granules connect and a failed-retrieval stretch breaks the line. */
export const DEFAULT_MEASUREMENT_GAP_MINUTES = 45;

/**
 * Fractional column offset of an instant against the rendered hour grid —
 * piecewise-linear between the columns' instants, so a mid-column sample
 * lands where its time says even when the step widens (3-hourly tails).
 * Null outside the plot (beyond half a step past either edge column).
 */
function columnOffsetAt(hourTimesMs: readonly number[], tMs: number): number | null {
  if (hourTimesMs.length === 0) return null;
  const first = hourTimesMs[0];
  const last = hourTimesMs[hourTimesMs.length - 1];
  const firstStep = hourTimesMs.length > 1 ? hourTimesMs[1] - first : 3_600_000;
  const lastStep = hourTimesMs.length > 1 ? last - hourTimesMs[hourTimesMs.length - 2] : 3_600_000;
  if (tMs < first - firstStep / 2 || tMs > last + lastStep / 2) return null;
  if (tMs <= first) return (tMs - first) / firstStep;
  if (tMs >= last) return hourTimesMs.length - 1 + (tMs - last) / lastStep;
  let index = 0;
  while (hourTimesMs[index + 1] < tMs) index += 1;
  return index + (tMs - hourTimesMs[index]) / (hourTimesMs[index + 1] - hourTimesMs[index]);
}

/**
 * An observation document at its native cadence, as plot-ready column
 * offsets: entries carrying a finite `valueKey` inside the rendered
 * window, in time order. Entries within `lineMaxQuality` form the line —
 * with an explicit null wherever consecutive line samples sit further
 * apart than the gap tolerance, because a retrieval outage must break
 * the line, never be interpolated across — and entries beyond it land in
 * `degraded`: published-but-qualified measurements a renderer marks
 * instead of joining.
 */
function measurementSamples(
  document: ObservationDocument | null | undefined,
  valueKey: string,
  hourTimesMs: readonly number[],
  gapMinutes: number,
  lineMaxQuality: number,
):
  | {
      line: Array<{ columnOffset: number; value: number } | null>;
      degraded: Array<{ columnOffset: number; value: number }>;
    }
  | undefined {
  if (!document) return undefined;
  const line: Array<{ columnOffset: number; value: number } | null> = [];
  const degraded: Array<{ columnOffset: number; value: number }> = [];
  let previousMs: number | null = null;
  for (const observation of document.observations) {
    const value = (observation as Record<string, unknown>)[valueKey];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const tMs = Date.parse(observation.observedAt);
    const columnOffset = columnOffsetAt(hourTimesMs, tMs);
    if (columnOffset === null) continue;
    if (observationQuality(observation) > lineMaxQuality) {
      degraded.push({ columnOffset, value });
      continue;
    }
    if (previousMs !== null && tMs - previousMs > gapMinutes * 60_000) line.push(null);
    line.push({ columnOffset, value });
    previousMs = tMs;
  }
  return line.some((entry) => entry !== null) || degraded.length > 0
    ? { line, degraded }
    : undefined;
}

/** The entry's published DQF; absent means the product's best grade. */
function observationQuality(observation: { quality?: number }): number {
  return observation.quality ?? 0;
}

function pitchBarbScale(columnWidth: number): number {
  const span = BARB_SCALE_MAX_COLUMN - BARB_SCALE_MIN_COLUMN;
  const fraction = Math.min(1, Math.max(0, (columnWidth - BARB_SCALE_MIN_COLUMN) / span));
  return BARB_SCALE_MIN + (1 - BARB_SCALE_MIN) * fraction;
}

const WING_MARKER_PATH =
  "M-9-1.6Q0-9.6 9-1.6Q8.1-.7 7.2-1.1Q0-6.2-7.2-1.1Q-8.1-.7-9-1.6Z" +
  "M-6-2.2L-.4 3.6.2 3.1-5.3-2.6Z" +
  "M6-2.2L.4 3.6-.2 3.1 5.3-2.6Z" +
  "M0 2.8a1.5 1.5 0 1 0 .01 0Z";
const CLOUD_MARKER_PATH =
  "M-7 2.5h14a3.2 3.2 0 0 0-.6-6.3A5 5 0 0 0-3-5a4 4 0 0 0-4 4 3 3 0 0 0 0 3.5Z";
const MARKER_COINCIDENCE_PX = 1;
const WING_TUCK_PX = 5;

function lapseNodes(hour: ResolvedHour, floorM: number): FieldNode[] {
  const first = hour.levels[0];
  if (!first || first.heightM <= floorM) return [];
  const surfaceLapse = surfaceLapseCPer1000Ft(hour.surface.temperatureC, floorM, first);
  if (surfaceLapse === null) return [];
  let lastLapse = surfaceLapse;
  const nodes: FieldNode[] = [{ altitudeM: floorM, value: surfaceLapse }];
  for (let index = 0; index < hour.levels.length; index += 1) {
    const level = hour.levels[index];
    const next = hour.levels[index + 1];
    const layerLapse = next ? lapseRateCPer1000Ft(level, next) : null;
    if (layerLapse !== null) lastLapse = layerLapse;
    nodes.push({ altitudeM: level.heightM, value: lastLapse });
  }
  return nodes;
}

function depressionNodes(hour: ResolvedHour, floorM: number): FieldNode[] {
  if (hour.levels.length === 0) return [];
  return [
    {
      altitudeM: floorM,
      value: dewPointDepressionC(hour.surface.temperatureC, hour.surface.dewPointC),
    },
    ...hour.levels.map((level) => ({
      altitudeM: level.heightM,
      value: dewPointDepressionC(level.temperatureC, level.dewPointC),
    })),
  ];
}

function thermalIndexNodes(hour: ResolvedHour, floorM: number): FieldNode[] {
  if (hour.levels.length === 0) return [];
  return [
    { altitudeM: floorM, value: 0 },
    ...hour.levels.map((level) => ({
      altitudeM: level.heightM,
      value: thermalIndexC({
        surfaceTemperatureC: hour.surface.temperatureC,
        surfaceElevationM: floorM,
        level,
      }),
    })),
  ];
}

function relativeHumidityNodes(hour: ResolvedHour, floorM: number): FieldNode[] {
  if (hour.levels.length === 0) return [];
  return [
    {
      altitudeM: floorM,
      value: relativeHumidityPercent(hour.surface.temperatureC, hour.surface.dewPointC),
    },
    ...hour.levels.map((level) => ({
      altitudeM: level.heightM,
      value: relativeHumidityPercent(level.temperatureC, level.dewPointC),
    })),
  ];
}

function shearRateNodes(hour: ResolvedHour, floorM: number): FieldNode[] {
  const column = [
    {
      heightM: floorM,
      windSpeedMps: hour.surface.windSpeedMps,
      windDirectionDeg: hour.surface.windDirectionDeg,
    },
    ...hour.levels,
  ];
  const nodes: FieldNode[] = [];
  for (let index = 0; index < column.length - 1; index += 1) {
    const lower = column[index];
    const upper = column[index + 1];
    const thicknessM = upper.heightM - lower.heightM;
    if (thicknessM <= 0) continue;
    nodes.push({
      altitudeM: lower.heightM + thicknessM / 2,
      value: (vectorShearMps(lower, upper) / thicknessM) * 1000,
    });
  }
  return nodes;
}

function omegaNodes(hour: ResolvedHour): FieldNode[] {
  return hour.levels
    .filter((level) => level.verticalVelocityPaS !== null)
    .map((level) => ({ altitudeM: level.heightM, value: level.verticalVelocityPaS as number }));
}

function verticalCrossing(
  points: Array<{ heightM: number; value: number }>,
  target: number,
): number | null {
  const sorted = [...points].sort((left, right) => left.heightM - right.heightM);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if ((target - lower.value) * (target - upper.value) > 0) continue;
    const span = upper.value - lower.value;
    if (span === 0) continue;
    return lower.heightM + ((target - lower.value) / span) * (upper.heightM - lower.heightM);
  }
  return null;
}

export function buildMeteogramScene(
  profile: SiteForecast,
  options: MeteogramOptions,
): MeteogramScene {
  const allHours = profile.hours.map(resolveHour);
  const hourIndices = resolveHourIndices(profile, options);
  let hours = (hourIndices ? hourIndices.map((index) => allHours[index]) : allHours).filter(
    (hour): hour is ResolvedHour => hour != null,
  );
  const overlays: Record<OverlayName, boolean> = { ...DEFAULT_OVERLAYS, ...options.overlays };

  // Smoke, per rendered hour — one source per strip, never a blend: the
  // profile's own block wins, and only a profile with no smoke at all
  // falls back to the supplied smoke document. A joined hour carries no
  // aot — deriving one from the quarantined plume column would under-paint
  // heavy smoke — so the joined strip shows surface magnitudes and no haze.
  const profileHasSmoke = hours.some((hour) => hour.smoke !== null);
  const joinedSmoke = !profileHasSmoke && options.smoke ? smokeHoursByValidAt(options.smoke) : null;
  const smokeSeries = hours.map((hour) => {
    if (profileHasSmoke) {
      return hour.smoke ? { surfaceUgm3: hour.smoke.surfaceUgm3, aot: hour.smoke.aot } : null;
    }
    const documentHour = joinedSmoke?.get(hour.validAt);
    if (!documentHour) return null;
    const surfaceUgm3 = p50(documentHour.smokePlumeSurfaceUgm3);
    if (surfaceUgm3 === null) return null;
    return { surfaceUgm3, aot: null };
  });
  const smokeSource = profileHasSmoke
    ? { model: profile.model, referenceTime: profile.run.referenceTime }
    : options.smoke && smokeSeries.some((entry) => entry !== null)
      ? { model: options.smoke.model, referenceTime: options.smoke.run.referenceTime }
      : null;

  let smokeAdjustment: MeteogramScene["smokeAdjustment"] = null;
  if (options.smokeAdjusted && smokeSource && !isSmokeAwareProfile(profile)) {
    let adjustedAnHour = false;
    hours = hours.map((hour, index) => {
      const entry = smokeSeries[index];
      if (!entry || entry.aot === null || entry.aot <= 0) return hour;
      const transmittance = smokeTransmittance(
        entry.aot,
        cosSolarZenith(hour.validAt, profile.site.latitude, profile.site.longitude),
      );
      if (transmittance >= 1) return hour;
      const wBand = hour.bands.thermalVelocityMps;
      if (
        hour.derived.thermalVelocityMps <= 0 &&
        wBand === null &&
        hour.bands.usableLiftTopM === null
      )
        return hour;
      adjustedAnHour = true;
      const adjustedW = smokeAdjustedThermalVelocityMps(
        hour.derived.thermalVelocityMps,
        transmittance,
      );
      const scale = Math.cbrt(transmittance);
      return {
        ...hour,
        derived: {
          ...hour.derived,
          thermalVelocityMps: adjustedW,
          usableLiftTopM: usableLiftTopM({
            modelElevationM: profile.site.modelElevationM,
            boundaryLayerTopM: hour.derived.boundaryLayerTopM,
            thermalVelocityMps: adjustedW,
            cloudBaseM: hour.derived.cloudBaseM,
            levels: hour.levels,
          }),
        },
        bands: {
          ...hour.bands,
          thermalVelocityMps: wBand ? { p25: wBand.p25 * scale, p75: wBand.p75 * scale } : null,
          usableLiftTopM: null,
        },
      };
    });
    if (adjustedAnHour) {
      smokeAdjustment = { smokeModel: smokeSource.model, smokeRun: smokeSource.referenceTime };
    }
  }
  const smooth = options.smooth !== false;
  const capeClasses = options.capeClasses ?? DEFAULT_CAPE_CLASSES;
  const fitColumns = Math.max(hours.length, Math.max(1, Math.floor(options.fitMinColumns ?? 1)));
  let columnWidth =
    options.widthPx !== undefined
      ? Math.max(1, (options.widthPx - MARGIN_LEFT - MARGIN_RIGHT) / fitColumns)
      : (options.columnWidthPx ?? DEFAULT_COLUMN_WIDTH);
  if (options.maxColumnWidthPx !== undefined) {
    columnWidth = Math.min(columnWidth, options.maxColumnWidthPx);
  }
  if (options.minColumnWidthPx !== undefined) {
    columnWidth = Math.max(columnWidth, options.minColumnWidthPx);
  }
  const plotHeight = options.plotHeightPx ?? DEFAULT_PLOT_HEIGHT;
  const floorM = profile.site.modelElevationM;
  const launchElevationM = options.launch?.elevationM ?? null;

  const ensembleDerived = hours.some(
    (hour) =>
      hour.bands.usableLiftTopM !== null ||
      hour.bands.boundaryLayerTopM !== null ||
      hour.bands.thermalVelocityMps !== null ||
      hour.bands.cloudBaseM !== null,
  );
  const sinkRateMps = options.sinkRateMps;
  const usableLiftRaw =
    sinkRateMps === undefined || ensembleDerived
      ? hours.map((hour) => hour.derived.usableLiftTopM)
      : hours.map((hour) =>
          usableLiftTopM(
            {
              modelElevationM: floorM,
              boundaryLayerTopM: hour.derived.boundaryLayerTopM,
              thermalVelocityMps: hour.derived.thermalVelocityMps,
              cloudBaseM: hour.derived.cloudBaseM,
              levels: hour.levels,
            },
            sinkRateMps,
          ),
        );

  let topM = Math.max(floorM + 800, overlays.launch ? (launchElevationM ?? floorM) : floorM);
  for (const [hourIndex, hour] of hours.entries()) {
    for (const candidate of [
      overlays.cloudBase ? hour.derived.cloudBaseM : null,
      overlays.usableLiftTop ? usableLiftRaw[hourIndex] : null,
      overlays.boundaryLayerTop ? hour.derived.boundaryLayerTopM : null,
      overlays.pblHeight && hour.surface.pblHeightM != null
        ? floorM + hour.surface.pblHeightM
        : null,
      overlays.cloudBase ? hour.bands.cloudBaseM?.p75 : null,
      overlays.usableLiftTop ? hour.bands.usableLiftTopM?.p75 : null,
      overlays.boundaryLayerTop ? hour.bands.boundaryLayerTopM?.p75 : null,
      overlays.pblHeight && hour.bands.pblHeightM != null
        ? floorM + hour.bands.pblHeightM.p75
        : null,
    ]) {
      if (candidate != null && candidate > topM) topM = candidate;
    }
    for (const level of hour.levels) {
      if (level.heightM > topM) topM = level.heightM;
    }
  }
  topM *= 1.04;

  const plotWidth = columnWidth * Math.max(hours.length, 1);
  const stripGeometry: StripGeometry = { marginLeft: MARGIN_LEFT, columnWidth, plotWidth };
  const hourTimesMs = hours.map((hour) => Date.parse(hour.validAt));
  const measurementGapMinutes = options.measurementGapMinutes ?? DEFAULT_MEASUREMENT_GAP_MINUTES;
  // The measured lines draw every sample at the product's own cadence; the
  // hourly nearest-instant joins below feed only the per-hour consumers —
  // dimming cells, pointer packets, and the sampling row. DSR's binary DQF
  // keeps degraded retrievals off the line (dimmed dots instead:
  // indicative, not quantitative); AOD's graded DQF ≤ 1 is the accepted
  // smoke-literature set, so every published sample joins its line.
  const observationSamples = measurementSamples(
    options.observations,
    "downwardShortwaveWm2",
    hourTimesMs,
    measurementGapMinutes,
    0,
  );
  const aotObservationSamples = measurementSamples(
    options.aotObservations,
    "aot",
    hourTimesMs,
    measurementGapMinutes,
    Number.POSITIVE_INFINITY,
  );
  const observationSeries = hours.map((hour) => {
    if (!options.observations) return null;
    const nearest = nearestObservation(options.observations, hour.validAt, 30);
    if (!nearest || !("downwardShortwaveWm2" in nearest.observation)) return null;
    const wm2 = nearest.observation.downwardShortwaveWm2;
    const quality = observationQuality(nearest.observation);
    return {
      wm2,
      // A degraded retrieval never shades the dimming cell: the ratio of a
      // provider-refused measurement to the clear-sky expectation would be
      // a plausible-but-wrong shadow.
      transmittance:
        quality > 0
          ? null
          : observedTransmittance(
              wm2,
              cosSolarZenith(hour.validAt, profile.site.latitude, profile.site.longitude),
            ),
      ...(quality > 0 ? { quality } : {}),
    };
  });
  const observationSource =
    options.observations &&
    (observationSamples !== undefined || observationSeries.some((entry) => entry !== null))
      ? {
          model: options.observations.model,
          lastObservedAt: options.observations.observed.lastObservedAt,
        }
      : null;
  const observationMeasuredTo = observationSource
    ? columnOffsetAt(hourTimesMs, Date.parse(observationSource.lastObservedAt))
    : null;

  const aotObservationSeries = hours.map((hour) => {
    if (!options.aotObservations) return null;
    const nearest = nearestObservation(options.aotObservations, hour.validAt, 30);
    if (!nearest || !("aot" in nearest.observation)) return null;
    const quality = observationQuality(nearest.observation);
    return { aot: nearest.observation.aot, ...(quality > 0 ? { quality } : {}) };
  });
  const aotObservationSource =
    options.aotObservations &&
    (aotObservationSamples !== undefined || aotObservationSeries.some((entry) => entry !== null))
      ? {
          model: options.aotObservations.model,
          lastObservedAt: options.aotObservations.observed.lastObservedAt,
        }
      : null;
  const aotObservationMeasuredTo = aotObservationSource
    ? columnOffsetAt(hourTimesMs, Date.parse(aotObservationSource.lastObservedAt))
    : null;

  const smokeStripSource = profileHasSmoke
    ? profile.semantics?.smoke === "radiativelyCoupled"
      ? { provenance: "model" as const }
      : {
          provenance: "model" as const,
          sourceLabel: "this model's forecast · not in its physics",
        }
    : smokeSource
      ? {
          provenance: "crossModel" as const,
          sourceLabel: `${smokeSource.model} · ${shortInstant(smokeSource.referenceTime)} run`,
        }
      : undefined;
  const observationSourceLabel = observationSource
    ? `${observationSource.model} · measured to ${shortInstant(observationSource.lastObservedAt)}`
    : undefined;
  const aotObservationSourceLabel = aotObservationSource
    ? `${aotObservationSource.model} · measured to ${shortInstant(aotObservationSource.lastObservedAt)}`
    : undefined;

  const stripSpecs = buildStripSpecs({
    hours,
    overlays,
    capeClasses,
    floorM,
    smokeSeries,
    observationSeries,
    observationSamples: observationSamples?.line,
    observationDegradedSamples: observationSamples?.degraded,
    observationMeasuredTo,
    aotObservationSeries,
    aotObservationSamples: aotObservationSamples?.line,
    aotObservationMeasuredTo,
    smokeStripSource,
    observationSourceLabel,
    aotObservationSourceLabel,
    geometry: stripGeometry,
  });
  const stackGeometry = stripStackGeometry(stripSpecs);

  const plotTop = stackGeometry.height + PROFILE_GAP;
  const plotBottom = plotTop + plotHeight;
  const width = MARGIN_LEFT + plotWidth + MARGIN_RIGHT;
  const surfaceTemperatureRow = overlays.surfaceTemperature && hours.length > 0;
  const height =
    plotBottom + HOUR_LABEL_DY + (surfaceTemperatureRow ? SURFACE_TEMP_ROW_PX : 0) + BOTTOM_PADDING;

  const y = (altitudeM: number) =>
    plotTop + plotHeight * (1 - (altitudeM - floorM) / (topM - floorM));
  const x = (index: number) => MARGIN_LEFT + index * columnWidth;
  const xCenter = (index: number) => x(index) + columnWidth / 2;

  const strips = layoutStrips(stripSpecs, {
    geometry: stripGeometry,
    stripLabels: options.stripLabels,
  });

  const fieldArgs = { floorM, topM, plotLeft: MARGIN_LEFT, plotTop, plotBottom, plotWidth };
  const fields: FieldLayer[] = [];
  const pushField = (key: FieldLayer["key"], nodesByHour: FieldNode[][], banding: FieldBanding) => {
    const paths = sampledFieldPaths({ ...fieldArgs, nodesByHour, banding });
    const ordered: Array<{ className: string; path: string }> = [];
    for (const className of banding.classNames) {
      if (className !== null && paths[className]) {
        ordered.push({ className, path: paths[className] });
      }
    }
    if (ordered.length > 0) fields.push({ key, paths: ordered });
  };

  const lapseNodesByHour = hours.map((hour) => lapseNodes(hour, floorM));
  if (overlays.stability) {
    pushField("stability", lapseNodesByHour, {
      breakpoints: STABILITY_CLASSES.slice(0, -1).map((entry) => entry.maxLapse),
      classNames: STABILITY_CLASSES.map((entry) => `meteo-gram-stab-${entry.className}`),
    });
  }
  if (overlays.clouds) {
    const modelCloudNodesByHour = hours.map((hour) =>
      hour.levels
        .filter((level) => level.cloudFractionPercent !== null)
        .map((level) => ({
          altitudeM: level.heightM,
          value: level.cloudFractionPercent as number,
        })),
    );
    const hasModelCloud = modelCloudNodesByHour.map((nodes) => nodes.length >= 2);
    pushField(
      "clouds",
      hours.map((hour, index) => (hasModelCloud[index] ? [] : depressionNodes(hour, floorM))),
      {
        breakpoints: [0.5, 1.5, 3],
        classNames: [
          "meteo-gram-cloud-dense",
          "meteo-gram-cloud-medium",
          "meteo-gram-cloud-light",
          null,
        ],
      },
    );
    pushField(
      "clouds",
      modelCloudNodesByHour.map((nodes, index) => (hasModelCloud[index] ? nodes : [])),
      {
        breakpoints: [30, 60, 85],
        classNames: [
          null,
          "meteo-gram-cloud-light",
          "meteo-gram-cloud-medium",
          "meteo-gram-cloud-dense",
        ],
      },
    );
  }
  if (overlays.thermalIndex) {
    pushField(
      "thermalIndex",
      hours.map((hour) => thermalIndexNodes(hour, floorM)),
      {
        breakpoints: [-8, -4, -1, 0],
        classNames: [
          "meteo-gram-ti-strong",
          "meteo-gram-ti-good",
          "meteo-gram-ti-fair",
          "meteo-gram-ti-weak",
          null,
        ],
      },
    );
  }
  if (overlays.relativeHumidity) {
    pushField(
      "relativeHumidity",
      hours.map((hour) => relativeHumidityNodes(hour, floorM)),
      {
        breakpoints: [60, 80, 95],
        classNames: [null, "meteo-gram-rh-60", "meteo-gram-rh-80", "meteo-gram-rh-95"],
      },
    );
  }
  if (overlays.windShear) {
    pushField(
      "windShear",
      hours.map((hour) => shearRateNodes(hour, floorM)),
      {
        breakpoints: [2, 4, 8],
        classNames: [
          null,
          "meteo-gram-shear-light",
          "meteo-gram-shear-moderate",
          "meteo-gram-shear-strong",
        ],
      },
    );
  }
  if (overlays.verticalVelocity) {
    pushField("verticalVelocity", hours.map(omegaNodes), {
      breakpoints: [-0.5, -0.1, 0.1, 0.5],
      classNames: [
        "meteo-gram-omega-lift-strong",
        "meteo-gram-omega-lift",
        null,
        "meteo-gram-omega-sink",
        "meteo-gram-omega-sink-strong",
      ],
    });
  }

  const series: SeriesElement[] = [];
  const labels: SceneLabel[] = [];

  const smoothSeries = (values: Array<number | null>) =>
    smooth
      ? smooth121(values.map((value, index) => ({ validAt: hours[index].validAt, value })))
      : values;

  const altitudeSeries = (
    key: SeriesElement["key"],
    className: string,
    values: Array<number | null>,
    bands: Array<Band>,
    strokeWidth: number,
    dash: string | null,
  ): { values: Array<number | null> } => {
    const path = pointPath(
      values.map((value, index) => (value == null ? null : { x: xCenter(index), y: y(value) })),
    );
    const band = bandPath(
      bands.map((entry, index) =>
        entry === null ? null : { x: xCenter(index), yLow: y(entry.p25), yHigh: y(entry.p75) },
      ),
    );
    series.push({ key, className, path, bandPath: band === "" ? null : band, strokeWidth, dash });
    return { values };
  };

  const smoothBand = (bands: Array<Band>): Array<Band> => {
    if (!smooth) return bands;
    const p25 = smoothSeries(bands.map((band) => band?.p25 ?? null));
    const p75 = smoothSeries(bands.map((band) => band?.p75 ?? null));
    return bands.map((band, index) =>
      band === null ? null : { p25: p25[index] as number, p75: p75[index] as number },
    );
  };

  if (overlays.boundaryLayerTop) {
    altitudeSeries(
      "boundaryLayerTop",
      "meteo-gram-series-boundary",
      hours.map((hour) => hour.derived.boundaryLayerTopM),
      hours.map((hour) => hour.bands.boundaryLayerTopM),
      2,
      "10 5",
    );
  }
  if (overlays.pblHeight && hours.some((hour) => hour.surface.pblHeightM != null)) {
    altitudeSeries(
      "modelPblTop",
      "meteo-gram-series-pbl",
      hours.map((hour) =>
        hour.surface.pblHeightM == null ? null : floorM + hour.surface.pblHeightM,
      ),
      hours.map((hour) =>
        hour.bands.pblHeightM == null
          ? null
          : { p25: floorM + hour.bands.pblHeightM.p25, p75: floorM + hour.bands.pblHeightM.p75 },
      ),
      1.6,
      "3 3",
    );
  }
  const cloudBaseValues = smoothSeries(hours.map((hour) => hour.derived.cloudBaseM));
  if (overlays.cloudBase) {
    altitudeSeries(
      "cloudBase",
      "meteo-gram-series-cloud-base",
      cloudBaseValues,
      smoothBand(hours.map((hour) => hour.bands.cloudBaseM)),
      1.8,
      "1 5",
    );
  }
  const usableValues = smoothSeries(usableLiftRaw);
  if (overlays.usableLiftTop) {
    altitudeSeries(
      "usableLiftTop",
      "meteo-gram-series-usable",
      usableValues,
      smoothBand(hours.map((hour) => hour.bands.usableLiftTopM)),
      2.3,
      null,
    );
  }

  const crossingSeries = (
    key: SeriesElement["key"],
    classNameOf: (target: number) => string,
    labelClassOf: (target: number) => string,
    labelTextOf: (target: number) => string,
    pointsOf: (hour: ResolvedHour) => Array<{ heightM: number; value: number }>,
    targets: number[],
    strokeOf: (target: number) => { width: number; dash: string | null },
  ) => {
    for (const target of targets) {
      const crossings = hours.map((hour) => verticalCrossing(pointsOf(hour), target));
      const path = pointPath(
        crossings.map((altitude, index) =>
          altitude == null ? null : { x: xCenter(index), y: y(altitude) },
        ),
      );
      if (path === "") continue;
      const stroke = strokeOf(target);
      series.push({
        key,
        className: classNameOf(target),
        path,
        bandPath: null,
        strokeWidth: stroke.width,
        dash: stroke.dash,
      });
      const labelIndex = crossings.reduce<number>(
        (best, altitude, index) => (altitude != null ? index : best),
        -1,
      );
      if (labelIndex >= 0) {
        labels.push({
          x: xCenter(labelIndex) - 4,
          y: y(crossings[labelIndex] as number) - 5,
          text: labelTextOf(target),
          className: labelClassOf(target),
          anchor: "end",
        });
      }
    }
  };

  if (overlays.temperature) {
    crossingSeries(
      "isotherm",
      (t) => (t === 0 ? "meteo-gram-isotherm meteo-gram-isotherm-freezing" : "meteo-gram-isotherm"),
      (t) =>
        t === 0
          ? "meteo-gram-isotherm-label meteo-gram-isotherm-label-freezing"
          : "meteo-gram-isotherm-label",
      (t) => `${t}°`,
      (hour) => [
        { heightM: floorM, value: hour.surface.temperatureC },
        ...hour.levels.map((level) => ({ heightM: level.heightM, value: level.temperatureC })),
      ],
      [0, 10, 20],
      (t) => (t === 0 ? { width: 1.7, dash: "7 3 1 3" } : { width: 1, dash: null }),
    );
  }
  if (overlays.dewPoint) {
    crossingSeries(
      "dewPointIsoline",
      () => "meteo-gram-dewpoint-isoline",
      () => "meteo-gram-dewpoint-label",
      (t) => `Td ${t}°`,
      (hour) => [
        { heightM: floorM, value: hour.surface.dewPointC },
        ...hour.levels.map((level) => ({ heightM: level.heightM, value: level.dewPointC })),
      ],
      [0, 10],
      () => ({ width: 1.2, dash: "4 3" }),
    );
  }

  const barbScale = options.barbScale ?? pitchBarbScale(columnWidth);
  const barbFootprint = 2 * BARB_GLYPH_RADIUS * barbScale;
  const barbStride =
    options.barbStride === undefined || options.barbStride === "auto"
      ? Math.max(1, Math.ceil(barbFootprint / columnWidth))
      : Math.max(1, Math.floor(options.barbStride));
  const barbMinGap = options.barbMinGapPx ?? BARB_MIN_GAP_PX * barbScale;
  const surfaceWindY = y(floorM) - (BARB_GLYPH_HEIGHT / 2) * barbScale;
  const barbs: BarbPlacement[] = [];
  if (overlays.wind) {
    hours.forEach((hour, index) => {
      if (index % barbStride !== 0) return;
      const cx = xCenter(index);
      const place = (
        cy: number,
        speedMps: number,
        directionDeg: number,
        altitudeM: number,
        surface: boolean,
      ) => {
        const speedKmh = msToKmh(speedMps);
        const parts = windBarbParts(speedKmh);
        const paths = windBarbPaths(speedKmh);
        barbs.push({
          x: cx,
          y: cy,
          directionDeg,
          speedKmh,
          calm: parts.calm,
          shaftPath: paths.shaft,
          pennantPaths: paths.pennants,
          scale: barbScale,
          hourIndex: index,
          altitudeM,
          surface,
        });
      };
      place(surfaceWindY, hour.surface.windSpeedMps, hour.surface.windDirectionDeg, floorM, true);
      const topIndex = hour.levels.length - 1;
      const topY = topIndex >= 0 ? y(hour.levels[topIndex].heightM) : null;
      let lastY = surfaceWindY;
      hour.levels.forEach((level, levelIndex) => {
        const levelY = y(level.heightM);
        if (levelIndex !== topIndex) {
          if (lastY - levelY < barbMinGap) return;
          if (topY !== null && levelY - topY < barbMinGap) return;
        }
        place(levelY, level.windSpeedMps, level.windDirectionDeg, level.heightM, false);
        lastY = levelY;
      });
    });
  }

  const gusts: GustMark[] = [];
  if (overlays.gusts) {
    const gustY = surfaceWindY - BARB_GLYPH_RADIUS * barbScale - 5;
    hours.forEach((hour, index) => {
      if (index % barbStride !== 0) return;
      const gustMps = hour.surface.windGustMps;
      if (gustMps == null) return;
      const speedKmh = msToKmh(gustMps);
      gusts.push({
        x: xCenter(index),
        y: gustY,
        speedKmh,
        label: `G${Math.round(speedKmh)}`,
      });
    });
  }

  const altitudeTicks: AltitudeTick[] = [];
  for (let tick = 0; tick <= 5; tick += 1) {
    const altitudeM = floorM + ((topM - floorM) * tick) / 5;
    altitudeTicks.push({
      altitudeM,
      y: y(altitudeM),
      labelMetres: `${Math.round(altitudeM)}m`,
      labelFeet: `${Math.round(altitudeM * M_TO_FT)}ft`,
    });
  }

  const byPressure = new Map<number, number[]>();
  for (const hour of hours) {
    for (const level of hour.levels) {
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
    .sort((left, right) => left.altitudeM - right.altitudeM)
    .filter(
      (entry, index, entries) =>
        index === 0 || entry.altitudeM - entries[index - 1].altitudeM >= 80,
    )
    .map((entry) => ({ ...entry, y: y(entry.altitudeM) }));

  const hourConvention = options.hourLabel ?? "24h";
  const hourText =
    typeof hourConvention === "function"
      ? (validAt: string) => hourConvention(validAt, options.timeZone)
      : hourConvention === "12h"
        ? (validAt: string) => twelveHourLabel(hourLabel(validAt, options.timeZone))
        : (validAt: string) => hourLabel(validAt, options.timeZone);
  const ariaHour =
    hourConvention === "24h" ? (validAt: string) => `${hourText(validAt)}:00` : hourText;

  const hourTicks: HourTick[] = hours.map((hour, index) => ({
    index,
    x: xCenter(index),
    label: hourText(hour.validAt),
    gridline: index % 2 === 0,
  }));

  const surfaceTemperatures: SurfaceTemperatureMark[] = surfaceTemperatureRow
    ? hours.map((hour, index) => ({
        x: xCenter(index),
        y: plotBottom + HOUR_LABEL_DY + SURFACE_TEMP_ROW_PX,
        temperatureC: hour.surface.temperatureC,
        label: `${Math.round(hour.surface.temperatureC)}°`,
      }))
    : [];

  const selectedHourIndex = hours.reduce(
    (best, hour, index) =>
      hour.derived.thermalVelocityMps > (hours[best]?.derived.thermalVelocityMps ?? 0)
        ? index
        : best,
    0,
  );
  const markers: SceneMarker[] = [];
  const markerIndices = (stride: number | { every: number } | undefined): number[] => {
    if (hours.length === 0) return [];
    if (stride === undefined) return [selectedHourIndex];
    const step = Math.max(1, Math.floor(typeof stride === "number" ? stride : stride.every));
    return hours
      .map((_, index) => index)
      .filter((index) => (((index - selectedHourIndex) % step) + step) % step === 0);
  };
  const cloudYByHour = new Map<number, number>();
  if (overlays.cloudBase) {
    for (const index of markerIndices(options.markerStride?.cloudBase)) {
      const cloudBase = cloudBaseValues[index];
      if (cloudBase == null) continue;
      cloudYByHour.set(index, y(cloudBase));
      markers.push({ kind: "cloud", x: xCenter(index), y: y(cloudBase), path: CLOUD_MARKER_PATH });
    }
  }
  if (overlays.usableLiftTop) {
    for (const index of markerIndices(options.markerStride?.usableLiftTop)) {
      const usable = usableValues[index];
      if (usable == null) continue;
      const cloudY = cloudYByHour.get(index);
      const atCloudBase =
        cloudY !== undefined && Math.abs(y(usable) - cloudY) <= MARKER_COINCIDENCE_PX;
      markers.push({
        kind: "wing",
        x: xCenter(index),
        y: atCloudBase ? cloudY + WING_TUCK_PX : y(usable),
        path: WING_MARKER_PATH,
        ...(atCloudBase ? { atCloudBase: true } : {}),
      });
    }
  }

  const launch =
    overlays.launch &&
    launchElevationM != null &&
    launchElevationM >= floorM &&
    launchElevationM <= topM
      ? {
          y: y(launchElevationM),
          altitudeM: launchElevationM,
          label: `${options.launch?.name ?? "launch"} ${Math.round(launchElevationM)} m`,
        }
      : null;

  const sampling: HourSampling[] = hours.map((hour, index) => {
    const surfaceWind = windToComponents(hour.surface.windSpeedMps, hour.surface.windDirectionDeg);
    const levelWinds = hour.levels.map((level) =>
      windToComponents(level.windSpeedMps, level.windDirectionDeg),
    );
    return {
      validAt: hour.validAt,
      temperatureC: [
        { altitudeM: floorM, value: hour.surface.temperatureC },
        ...hour.levels.map((level) => ({ altitudeM: level.heightM, value: level.temperatureC })),
      ],
      dewPointC: [
        { altitudeM: floorM, value: hour.surface.dewPointC },
        ...hour.levels.map((level) => ({ altitudeM: level.heightM, value: level.dewPointC })),
      ],
      lapseCPer1000Ft: lapseNodesByHour[index],
      thermalIndexC: thermalIndexNodes(hour, floorM),
      relativeHumidityPercent: relativeHumidityNodes(hour, floorM),
      windU: [
        { altitudeM: floorM, value: surfaceWind.uMps },
        ...hour.levels.map((level, levelIndex) => ({
          altitudeM: level.heightM,
          value: levelWinds[levelIndex].uMps,
        })),
      ],
      windV: [
        { altitudeM: floorM, value: surfaceWind.vMps },
        ...hour.levels.map((level, levelIndex) => ({
          altitudeM: level.heightM,
          value: levelWinds[levelIndex].vMps,
        })),
      ],
      verticalVelocityPaS: omegaNodes(hour),
      smoke: overlays.smoke ? smokeSeries[index] : null,
      observation: overlays.observedIrradiance ? observationSeries[index] : null,
      aotObservation: overlays.observedAot ? aotObservationSeries[index] : null,
    };
  });

  const scene: MeteogramScene = {
    width,
    height,
    ariaLabel: sceneAriaLabel(
      profile,
      hours.map((hour) => hour.validAt),
      options.timeZone,
      ariaHour,
    ),
    scales: {
      plotLeft: MARGIN_LEFT,
      plotTop,
      plotWidth,
      plotHeight,
      columnWidth,
      stripTop: METRIC_TOP,
      floorM,
      topM,
      hourCount: hours.length,
      surfaceWindY,
    },
    axes: { altitude: altitudeTicks, pressureAltitude, hours: hourTicks },
    strips,
    fields,
    series,
    barbs,
    gusts,
    surfaceTemperatures,
    labels,
    markers,
    launch,
    selectedHourIndex,
    selection: null,
    smokeSource: overlays.smoke ? smokeSource : null,
    smokeAdjustment,
    observationSource: overlays.observedIrradiance ? observationSource : null,
    aotObservationSource: overlays.observedAot ? aotObservationSource : null,
    stripDivider:
      stackGeometry.dividerY === null
        ? null
        : { y: stackGeometry.dividerY, label: STRIP_DIVIDER_LABEL },
    highlightSelectedHour: overlays.selectedHour,
    hourValidAts: hours.map((hour) => hour.validAt),
    sampling,
  };
  if (options.selection != null) {
    scene.selection = resolveSelection(scene, options.selection);
  }
  return scene;
}

function sceneAriaLabel(
  profile: SiteForecast,
  hourValidAts: ReadonlyArray<string>,
  timeZone: string,
  ariaHour: (validAt: string) => string,
): string {
  const chartDescription =
    "surface metric strips above a time-height field; derived series, isotherms, shading overlays and winds aloft are drawn over the profile";
  const identity = `Meteogram for ${profile.site.name}, model ${profile.model}`;
  if (hourValidAts.length === 0) return `${identity}, no forecast hours: ${chartDescription}.`;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const first = hourValidAts[0];
  const last = hourValidAts[hourValidAts.length - 1];
  const firstDay = day.format(new Date(first));
  const lastDay = day.format(new Date(last));
  const span =
    firstDay === lastDay
      ? `${firstDay} ${ariaHour(first)} to ${ariaHour(last)}`
      : `${firstDay} ${ariaHour(first)} to ${lastDay} ${ariaHour(last)}`;
  return `${identity}, ${span} (${timeZone}): ${chartDescription}.`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function twelveHourLabel(h23Label: string): string {
  const hour = Number(h23Label);
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

const hourLabelFormatters = new Map<string, Intl.DateTimeFormat>();

function hourLabel(validAt: string, timeZone: string): string {
  let formatter = hourLabelFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false });
    hourLabelFormatters.set(timeZone, formatter);
  }
  // ICU versions disagree on zero-padding "numeric" h23 hours ("07" vs "7");
  // normalize through Number so labels are deterministic everywhere.
  return String(Number(formatter.format(new Date(validAt))));
}
