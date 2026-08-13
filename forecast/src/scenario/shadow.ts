import {
  CEILING_TOLERANCE_M,
  CENSORED_SCALARS,
  DERIVED_SCALARS,
  LEVEL_SCALARS,
  circularMedian,
} from "../ensemble.js";
import {
  PyFloat,
  type TaggedValue,
  isPyFloat,
  isTaggedNumber,
  numberValue,
  taggedNumber,
} from "./json.js";

type PyNumber = number | PyFloat;
type TaggedRecord = { [key: string]: TaggedValue };

const DRY_ADIABATIC_LAPSE_C_PER_M = 0.0098;
const SINK_RATE_MPS = 1.0;
const SATURATED_DEPRESSION_C = 0.5;
const PERCENTILE_POINTS = [10, 25, 50, 75, 90] as const;

const DEGREE_FIELDS = ["windDirectionDeg", "aspectDeg"];
const INTEGER_ROUNDED_FIELDS = ["capeJkg", "cinJkg"];

const F = (value: number): PyFloat => new PyFloat(value);
const val = numberValue;

// Python max/min return one of their arguments, so the winning tag is the
// winning argument's.
function pyMax(a: PyNumber, b: PyNumber): PyNumber {
  return val(b) > val(a) ? b : a;
}

function pyMin(a: PyNumber, b: PyNumber): PyNumber {
  return val(b) < val(a) ? b : a;
}

function add(a: PyNumber, b: PyNumber): PyNumber {
  return taggedNumber(val(a) + val(b), isPyFloat(a) || isPyFloat(b));
}

function sub(a: PyNumber, b: PyNumber): PyNumber {
  return taggedNumber(val(a) - val(b), isPyFloat(a) || isPyFloat(b));
}

function clampT(value: PyNumber, minimum: PyNumber, maximum: PyNumber): PyNumber {
  return pyMin(maximum, pyMax(minimum, value));
}

function requireNumber(value: TaggedValue | undefined, label: string): PyNumber {
  if (value === undefined || !isTaggedNumber(value)) {
    throw new Error(`shadow derivation: ${label} is not a number`);
  }
  return value;
}

function normalizeDegreesT(degrees: PyNumber): PyNumber {
  const wrapped = ((val(degrees) % 360) + 360) % 360;
  return taggedNumber(wrapped, isPyFloat(degrees));
}

interface ShadowLevel extends TaggedRecord {}

function parcelLclAglM(temperatureC: PyNumber, dewPointC: PyNumber): PyNumber {
  if (val(dewPointC) >= val(temperatureC)) {
    return F(0.0);
  }
  const temperatureK = val(temperatureC) + 273.15;
  const dewPointK = val(dewPointC) + 273.15;
  const lclTemperatureK =
    1.0 / (1.0 / (dewPointK - 56.0) + Math.log(temperatureK / dewPointK) / 800.0) + 56.0;
  return F(Math.max(0.0, (temperatureK - lclTemperatureK) / DRY_ADIABATIC_LAPSE_C_PER_M));
}

function firstSaturatedAltitudeM(
  surfaceDewPointDepressionC: PyNumber,
  modelElevationM: PyNumber,
  levels: ShadowLevel[],
): PyNumber | null {
  const samples: Array<[PyNumber, PyNumber]> = [
    [modelElevationM, surfaceDewPointDepressionC],
    ...levels.map((level): [PyNumber, PyNumber] => [
      requireNumber(level["heightM"], "level heightM"),
      requireNumber(level["dewPointDepressionC"], "level dewPointDepressionC"),
    ]),
  ];
  const profile = samples.filter(([, depression]) => Number.isFinite(val(depression)));
  if (profile.length === 0) {
    return null;
  }
  if (val(profile[0][1]) <= SATURATED_DEPRESSION_C) {
    return profile[0][0];
  }
  for (let index = 1; index < profile.length; index += 1) {
    const [belowM, belowC] = profile[index - 1];
    const [aboveM, aboveC] = profile[index];
    if (val(aboveC) <= SATURATED_DEPRESSION_C) {
      const fraction = (val(belowC) - SATURATED_DEPRESSION_C) / (val(belowC) - val(aboveC));
      return F(val(belowM) + fraction * (val(aboveM) - val(belowM)));
    }
  }
  return null;
}

function cloudBaseM(
  surfaceTemperatureC: PyNumber,
  dewPointDepressionC: PyNumber,
  modelElevationM: PyNumber,
  levels: ShadowLevel[],
): PyNumber {
  let base = add(
    modelElevationM,
    parcelLclAglM(surfaceTemperatureC, sub(surfaceTemperatureC, dewPointDepressionC)),
  );
  const firstSaturated = firstSaturatedAltitudeM(dewPointDepressionC, modelElevationM, levels);
  if (firstSaturated !== null) {
    base = pyMin(base, firstSaturated);
  }
  return Number.isFinite(val(base)) ? pyMax(modelElevationM, base) : modelElevationM;
}

function boundaryLayerDepth(
  surfaceTemperatureC: PyNumber,
  modelElevationM: PyNumber,
  levels: ShadowLevel[],
): PyNumber {
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const heightM = requireNumber(level["heightM"], "level heightM");
    const temperatureC = requireNumber(level["temperatureC"], "level temperatureC");
    const altitudeAglM = sub(heightM, modelElevationM);
    const liftedParcelTemperatureC =
      val(surfaceTemperatureC) - val(altitudeAglM) * DRY_ADIABATIC_LAPSE_C_PER_M;
    if (liftedParcelTemperatureC > val(temperatureC)) {
      continue;
    }

    if (index === 0) {
      return pyMax(F(0.0), altitudeAglM);
    }
    const previous = levels[index - 1];
    const previousHeightM = requireNumber(previous["heightM"], "level heightM");
    const previousTemperatureC = requireNumber(previous["temperatureC"], "level temperatureC");
    const previousAglM = sub(previousHeightM, modelElevationM);
    const lapse =
      (val(temperatureC) - val(previousTemperatureC)) / (val(heightM) - val(previousHeightM));
    const denominator = DRY_ADIABATIC_LAPSE_C_PER_M + lapse;
    if (Math.abs(denominator) < 0.00001) {
      return pyMax(F(0.0), previousAglM);
    }
    return pyMax(
      F(0.0),
      F(
        (val(surfaceTemperatureC) - val(previousTemperatureC) + lapse * val(previousAglM)) /
          denominator,
      ),
    );
  }

  if (levels.length > 0) {
    return pyMax(
      F(0.0),
      sub(requireNumber(levels[levels.length - 1]["heightM"], "level heightM"), modelElevationM),
    );
  }
  return F(0.0);
}

function thermalVelocity(
  surfaceTemperatureC: PyNumber,
  sensibleHeatFluxWm2: PyNumber,
  latentHeatFluxWm2: PyNumber,
  boundaryLayerDepthM: PyNumber,
  firstPressureHpa: PyNumber | null,
): PyNumber {
  if (val(boundaryLayerDepthM) <= 0 || firstPressureHpa === null) {
    return F(0.0);
  }
  const surfaceTemperatureK = val(surfaceTemperatureC) + 273.15;
  const virtualHeatFlux =
    val(sensibleHeatFluxWm2) + 0.000245268 * surfaceTemperatureK * val(latentHeatFluxWm2);
  if (virtualHeatFlux <= 0) {
    return F(0.0);
  }
  const potentialTemperatureK = surfaceTemperatureK * (1015 / val(firstPressureHpa)) ** 0.28482;
  return F(
    Math.cbrt((0.0075516 / potentialTemperatureK) * virtualHeatFlux * val(boundaryLayerDepthM)),
  );
}

function usableLiftTop(
  modelElevationM: PyNumber,
  cloudBase: PyNumber,
  boundaryLayerDepthM: PyNumber,
  thermalVelocityMps: PyNumber,
  levels: ShadowLevel[],
): PyNumber | null {
  if (val(boundaryLayerDepthM) <= 0 || val(thermalVelocityMps) * 2.02 < SINK_RATE_MPS) {
    return null;
  }

  let previousAltitudeAglM: PyNumber = F(val(boundaryLayerDepthM) * 0.2);
  let previousUpdraftMs = val(thermalVelocityMps) * 1.97;

  for (const level of levels) {
    const heightM = requireNumber(level["heightM"], "level heightM");
    const altitudeAglM = sub(heightM, modelElevationM);
    if (val(altitudeAglM) < val(boundaryLayerDepthM) * 0.25) {
      continue;
    }
    if (val(heightM) >= val(cloudBase)) {
      return cloudBase;
    }

    const normalizedHeight = val(altitudeAglM) / val(boundaryLayerDepthM);
    const updraftMs =
      val(thermalVelocityMps) *
      4 *
      Math.cbrt(Math.max(0.0, normalizedHeight)) *
      (1 - 0.8 * normalizedHeight);
    if (updraftMs <= SINK_RATE_MPS) {
      const fraction = Math.min(
        1.0,
        Math.max(0.0, (SINK_RATE_MPS - previousUpdraftMs) / (updraftMs - previousUpdraftMs)),
      );
      return pyMin(
        cloudBase,
        F(
          val(modelElevationM) +
            val(previousAltitudeAglM) +
            fraction * (val(altitudeAglM) - val(previousAltitudeAglM)),
        ),
      );
    }
    previousAltitudeAglM = altitudeAglM;
    previousUpdraftMs = updraftMs;
  }

  return pyMin(cloudBase, add(modelElevationM, boundaryLayerDepthM));
}

const OPTIONAL_SURFACE_FIELDS: ReadonlyArray<[string, (value: PyNumber) => PyNumber]> = [
  ["windGustMps", (v) => pyMax(F(0.0), v)],
  ["capeJkg", (v) => pyMax(F(0.0), v)],
  ["cinJkg", (v) => pyMin(F(0.0), v)],
  ["pblHeightM", (v) => pyMax(F(0.0), v)],
  ["lowCloudPercent", (v) => clampT(v, F(0.0), F(100.0))],
  ["midCloudPercent", (v) => clampT(v, F(0.0), F(100.0))],
  ["highCloudPercent", (v) => clampT(v, F(0.0), F(100.0))],
];

function shadowDeriveLevel(level: ShadowLevel): TaggedRecord {
  const temperatureC = requireNumber(level["temperatureC"], "level temperatureC");
  const derived: TaggedRecord = {
    pressureHpa: requireNumber(level["pressureHpa"], "level pressureHpa"),
    heightM: requireNumber(level["heightM"], "level heightM"),
    temperatureC,
    dewPointC: sub(
      temperatureC,
      requireNumber(level["dewPointDepressionC"], "level dewPointDepressionC"),
    ),
    windSpeedMps: pyMax(F(0.0), requireNumber(level["windSpeedMps"], "level windSpeedMps")),
    windDirectionDeg: normalizeDegreesT(
      requireNumber(level["windDirectionDeg"], "level windDirectionDeg"),
    ),
  };
  if (level["verticalVelocityPaS"] !== undefined) {
    derived["verticalVelocityPaS"] = requireNumber(
      level["verticalVelocityPaS"],
      "level verticalVelocityPaS",
    );
  }
  if (level["cloudFractionPercent"] !== undefined) {
    derived["cloudFractionPercent"] = clampT(
      requireNumber(level["cloudFractionPercent"], "level cloudFractionPercent"),
      F(0.0),
      F(100.0),
    );
  }
  return derived;
}

function shadowDeriveHour(source: TaggedRecord, modelElevationM: PyNumber): TaggedRecord {
  const levels = (source["levels"] as ShadowLevel[])
    .filter((level) => {
      const heightM = val(requireNumber(level["heightM"], "level heightM"));
      return Number.isFinite(heightM) && heightM > val(modelElevationM) + 20;
    })
    .slice()
    .sort(
      (a, b) =>
        val(requireNumber(a["heightM"], "level heightM")) -
        val(requireNumber(b["heightM"], "level heightM")),
    );

  const temperatureC = requireNumber(source["temperatureC"], "temperatureC");
  const dewPointDepressionC = requireNumber(source["dewPointDepressionC"], "dewPointDepressionC");
  const cloudBase = cloudBaseM(temperatureC, dewPointDepressionC, modelElevationM, levels);
  const depth = boundaryLayerDepth(temperatureC, modelElevationM, levels);
  const thermalVelocityMps = thermalVelocity(
    temperatureC,
    requireNumber(source["sensibleHeatFluxWm2"], "sensibleHeatFluxWm2"),
    requireNumber(source["latentHeatFluxWm2"], "latentHeatFluxWm2"),
    depth,
    levels.length > 0 ? requireNumber(levels[0]["pressureHpa"], "level pressureHpa") : null,
  );
  const usableLift = usableLiftTop(modelElevationM, cloudBase, depth, thermalVelocityMps, levels);

  const surface: TaggedRecord = {
    seaLevelPressureHpa: requireNumber(source["seaLevelPressureHpa"], "seaLevelPressureHpa"),
    temperatureC,
    dewPointC: sub(temperatureC, dewPointDepressionC),
    windSpeedMps: pyMax(F(0.0), requireNumber(source["windSpeedMps"], "windSpeedMps")),
    windDirectionDeg: normalizeDegreesT(
      requireNumber(source["windDirectionDeg"], "windDirectionDeg"),
    ),
    cloudCoverPercent: clampT(
      requireNumber(source["cloudCoverPercent"], "cloudCoverPercent"),
      F(0.0),
      F(100.0),
    ),
    precipitationMmHr: pyMax(F(0.0), requireNumber(source["precipitationMm"], "precipitationMm")),
    sensibleHeatFluxWm2: requireNumber(source["sensibleHeatFluxWm2"], "sensibleHeatFluxWm2"),
    latentHeatFluxWm2: requireNumber(source["latentHeatFluxWm2"], "latentHeatFluxWm2"),
  };
  for (const [fieldName, sanitize] of OPTIONAL_SURFACE_FIELDS) {
    if (fieldName in source) {
      surface[fieldName] = sanitize(requireNumber(source[fieldName], fieldName));
    }
  }

  const hour: TaggedRecord = {
    validAt: source["validAt"] as string,
    surface,
    levels: levels.map(shadowDeriveLevel),
    derived: {
      boundaryLayerTopM: val(depth) > 0 ? add(modelElevationM, depth) : null,
      thermalVelocityMps,
      cloudBaseM: cloudBase,
      usableLiftTopM: usableLift,
    },
  };
  if (source["smoke"] !== undefined) {
    hour["smoke"] = Object.fromEntries(
      Object.entries(source["smoke"] as TaggedRecord).map(([name, value]) => [
        name,
        pyMax(F(0.0), requireNumber(value, `smoke.${name}`)),
      ]),
    );
  }
  return hour;
}

export function shadowDeriveSiteForecast(
  source: TaggedRecord,
  model: string,
  semantics: TaggedValue,
): TaggedRecord {
  const modelElevationM = requireNumber(source["modelElevationM"], "modelElevationM");
  const site: TaggedRecord = {
    id: source["siteId"] as string,
    name: source["siteName"] as string,
    latitude: requireNumber(source["latitude"], "latitude"),
    longitude: requireNumber(source["longitude"], "longitude"),
    modelElevationM,
  };
  if (source["siteTimeZone"]) {
    site["timeZone"] = source["siteTimeZone"] as string;
  }
  return {
    schemaVersion: 2,
    model,
    run: {
      referenceTime: source["referenceTime"] as string,
      generatedAt: source["generatedAt"] as string,
    },
    site,
    semantics,
    hours: (source["hours"] as TaggedRecord[]).map((hour) =>
      shadowDeriveHour(hour, modelElevationM),
    ),
  };
}

function percentileT(sortedValues: readonly PyNumber[], point: number): PyNumber {
  if (sortedValues.length === 0) {
    throw new Error("shadow percentile of no values");
  }
  const rank = ((sortedValues.length - 1) * point) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sortedValues[low];
  }
  return F(
    val(sortedValues[low]) + (rank - low) * (val(sortedValues[high]) - val(sortedValues[low])),
  );
}

function percentileBlockT(values: ReadonlyArray<TaggedValue | undefined>): TaggedRecord {
  const present = values
    .filter(
      (value): value is PyNumber => value !== null && value !== undefined && isTaggedNumber(value),
    )
    .sort((a, b) => val(a) - val(b));
  const block: TaggedRecord = { members: present.length };
  for (const point of PERCENTILE_POINTS) {
    block[`p${point}`] = present.length > 0 ? percentileT(present, point) : null;
  }
  return block;
}

function surfaceOf(hour: TaggedRecord): TaggedRecord {
  return hour["surface"] as TaggedRecord;
}

function levelsOf(hour: TaggedRecord): ShadowLevel[] {
  return hour["levels"] as ShadowLevel[];
}

function derivedOf(hour: TaggedRecord): TaggedRecord {
  return hour["derived"] as TaggedRecord;
}

function aggregatePressureLevelsT(memberHours: readonly TaggedRecord[]): TaggedRecord[] {
  const byPressure = new Map<number, ShadowLevel[]>();
  const firstInsertedPressureTag = new Map<number, PyNumber>();
  for (const hour of memberHours) {
    for (const level of levelsOf(hour)) {
      const pressure = requireNumber(level["pressureHpa"], "level pressureHpa");
      const bucket = byPressure.get(val(pressure));
      if (bucket === undefined) {
        byPressure.set(val(pressure), [level]);
        firstInsertedPressureTag.set(val(pressure), pressure);
      } else {
        bucket.push(level);
      }
    }
  }

  const aggregated: TaggedRecord[] = [];
  for (const [pressure, levels] of byPressure) {
    const block: TaggedRecord = { pressureHpa: firstInsertedPressureTag.get(pressure)! };
    for (const key of LEVEL_SCALARS) {
      block[key] = percentileBlockT(levels.map((level) => level[key]));
    }
    block["windDirectionDeg"] = F(
      circularMedian(
        levels.map((level) =>
          val(requireNumber(level["windDirectionDeg"], "level windDirectionDeg")),
        ),
      ),
    );
    aggregated.push(block);
  }
  aggregated.sort(
    (a, b) =>
      val((a["heightM"] as TaggedRecord)["p50"] as PyNumber) -
      val((b["heightM"] as TaggedRecord)["p50"] as PyNumber),
  );
  return aggregated;
}

function countCeiledMembersT(memberHours: readonly TaggedRecord[], key: string): number {
  let count = 0;
  for (const hour of memberHours) {
    const value = derivedOf(hour)[key];
    const levels = levelsOf(hour);
    if (value === null || value === undefined || levels.length === 0) {
      continue;
    }
    const ceiling = val(requireNumber(levels[levels.length - 1]["heightM"], "level heightM"));
    if (val(value as PyNumber) >= ceiling - CEILING_TOLERANCE_M) {
      count += 1;
    }
  }
  return count;
}

export function shadowAggregateMemberProfiles(
  memberProfiles: readonly TaggedRecord[],
  {
    surfaceScalars,
    optionalSurfaceScalars = [],
  }: { surfaceScalars: readonly string[]; optionalSurfaceScalars?: readonly string[] },
): TaggedRecord[] {
  const firstHours = memberProfiles[0]["hours"] as TaggedRecord[];
  const aggregatedHours: TaggedRecord[] = [];
  for (let hourIndex = 0; hourIndex < firstHours.length; hourIndex += 1) {
    const memberHours = memberProfiles.map(
      (profile) => (profile["hours"] as TaggedRecord[])[hourIndex],
    );
    const surface: TaggedRecord = {};
    for (const key of surfaceScalars) {
      if (key === "windDirectionDeg") {
        surface[key] = F(
          circularMedian(
            memberHours.map((hour) => val(requireNumber(surfaceOf(hour)[key], `surface ${key}`))),
          ),
        );
        continue;
      }
      const values = optionalSurfaceScalars.includes(key)
        ? memberHours.map((hour) => surfaceOf(hour)[key])
        : memberHours.map((hour) => {
            if (!(key in surfaceOf(hour))) {
              throw new Error(`shadow member surface is missing required field '${key}'`);
            }
            return surfaceOf(hour)[key];
          });
      surface[key] = percentileBlockT(values);
    }

    const derived: TaggedRecord = {};
    for (const key of DERIVED_SCALARS) {
      const block = percentileBlockT(memberHours.map((hour) => derivedOf(hour)[key]));
      derived[key] = (CENSORED_SCALARS as readonly string[]).includes(key)
        ? { ceiledMembers: countCeiledMembersT(memberHours, key), ...block }
        : block;
    }

    aggregatedHours.push({
      validAt: memberHours[0]["validAt"] as string,
      surface,
      levels: aggregatePressureLevelsT(memberHours),
      derived,
    });
  }
  return aggregatedHours;
}

// Absorbs the value authority's ~1 ulp reassociations while still catching
// structural divergence loudly.
const RECONCILE_TOLERANCE = 1e-9;

/** The authority's values with the shadow's Python types; throws when they disagree beyond float noise. */
export function reconcile(real: unknown, shadow: TaggedValue, path = "$"): TaggedValue {
  if (real === null || typeof real === "string" || typeof real === "boolean") {
    if (real !== shadow) {
      throw new Error(
        `scenario shadow mismatch at ${path}: authority ${JSON.stringify(real)}, shadow ${JSON.stringify(shadow)}`,
      );
    }
    return real;
  }
  if (typeof real === "number") {
    if (!isTaggedNumber(shadow)) {
      throw new Error(`scenario shadow mismatch at ${path}: shadow is not a number`);
    }
    const shadowValue = val(shadow);
    const scale = Math.max(1, Math.abs(real), Math.abs(shadowValue));
    if (!(Math.abs(real - shadowValue) <= RECONCILE_TOLERANCE * scale)) {
      throw new Error(
        `scenario shadow mismatch at ${path}: authority ${real}, shadow ${shadowValue}`,
      );
    }
    return taggedNumber(real, isPyFloat(shadow));
  }
  if (Array.isArray(real)) {
    if (!Array.isArray(shadow) || shadow.length !== real.length) {
      throw new Error(`scenario shadow mismatch at ${path}: array shape differs`);
    }
    return real.map((item, index) => reconcile(item, shadow[index], `${path}[${index}]`));
  }
  if (typeof real === "object") {
    if (
      shadow === null ||
      typeof shadow !== "object" ||
      Array.isArray(shadow) ||
      isPyFloat(shadow)
    ) {
      throw new Error(`scenario shadow mismatch at ${path}: object shape differs`);
    }
    const shadowRecord = shadow as TaggedRecord;
    const result: TaggedRecord = {};
    for (const [key, item] of Object.entries(real)) {
      if (!(key in shadowRecord)) {
        throw new Error(`scenario shadow mismatch at ${path}: shadow lacks key '${key}'`);
      }
      result[key] = reconcile(item, shadowRecord[key], `${path}.${key}`);
    }
    if (Object.keys(shadowRecord).length !== Object.keys(result).length) {
      throw new Error(`scenario shadow mismatch at ${path}: shadow has extra keys`);
    }
    return result;
  }
  throw new Error(`scenario shadow mismatch at ${path}: unsupported value`);
}

export function applyRoundingTags(
  rounded: unknown,
  tagged: TaggedValue,
  integerContext = false,
  path = "$",
): TaggedValue {
  if (rounded === null || typeof rounded === "string" || typeof rounded === "boolean") {
    return rounded;
  }
  if (typeof rounded === "number") {
    if (!isTaggedNumber(tagged)) {
      throw new Error(`scenario rounding merge at ${path}: tagged tree is not a number`);
    }
    return taggedNumber(rounded, integerContext ? false : isPyFloat(tagged));
  }
  if (Array.isArray(rounded)) {
    if (!Array.isArray(tagged) || tagged.length !== rounded.length) {
      throw new Error(`scenario rounding merge at ${path}: array shape differs`);
    }
    return rounded.map((item, index) =>
      applyRoundingTags(item, tagged[index], integerContext, `${path}[${index}]`),
    );
  }
  if (typeof rounded === "object") {
    if (
      tagged === null ||
      typeof tagged !== "object" ||
      Array.isArray(tagged) ||
      isPyFloat(tagged)
    ) {
      throw new Error(`scenario rounding merge at ${path}: object shape differs`);
    }
    const taggedRecord = tagged as TaggedRecord;
    const result: TaggedRecord = {};
    for (const [key, item] of Object.entries(rounded)) {
      if (!(key in taggedRecord)) {
        throw new Error(`scenario rounding merge at ${path}: tagged tree lacks key '${key}'`);
      }
      if (DEGREE_FIELDS.includes(key)) {
        result[key] = item as TaggedValue;
        continue;
      }
      result[key] = applyRoundingTags(
        item,
        taggedRecord[key],
        integerContext || INTEGER_ROUNDED_FIELDS.includes(key),
        `${path}.${key}`,
      );
    }
    return result;
  }
  throw new Error(`scenario rounding merge at ${path}: unsupported value`);
}
