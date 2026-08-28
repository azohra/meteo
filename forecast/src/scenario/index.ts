import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import type { ZodError } from "zod";
import {
  scenarioCapabilitiesSchema,
  scenarioIndexSchema,
  type ScenarioCapabilities,
} from "./contract.js";
import { deriveSiteForecast, type SourceProfile } from "../derive.js";
import { aggregateMemberProfiles, type MemberProfile } from "../ensemble.js";
import { packagedModelsPath } from "../catalogue.js";
import { roundDocument } from "../publish.js";
import { randomFromMaterial } from "./rng.js";

type PlainRecord = Record<string, unknown>;

const SURFACE_OPTIONAL_CAPABILITIES: Record<string, keyof ScenarioCapabilities> = {
  "surface.windGustMps": "gust",
  "surface.capeJkg": "cape",
  "surface.cinJkg": "cin",
  "surface.pblHeightM": "pblHeight",
};
const CLOUD_LAYER_FIELDS = ["lowCloudPercent", "midCloudPercent", "highCloudPercent"] as const;
const BASE_SOURCE_FIELDS = [
  "seaLevelPressureHpa",
  "temperatureC",
  "dewPointDepressionC",
  "windSpeedMps",
  "windDirectionDeg",
  "cloudCoverPercent",
  "precipitationMm",
  "sensibleHeatFluxWm2",
  "latentHeatFluxWm2",
  "levels",
] as const;
const BASE_LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "dewPointDepressionC",
  "windSpeedMps",
  "windDirectionDeg",
] as const;
const ENSEMBLE_SURFACE_SCALARS = [
  "seaLevelPressureHpa",
  "temperatureC",
  "dewPointC",
  "windSpeedMps",
  "windDirectionDeg",
  "cloudCoverPercent",
  "precipitationMmHr",
  "sensibleHeatFluxWm2",
  "latentHeatFluxWm2",
] as const;
const PERCENTILE_KEYS = ["p10", "p25", "p50", "p75", "p90"] as const;
const PERCENTILE_PATH_KEYS = [...PERCENTILE_KEYS, "members"] as const;

/** A scenario cannot be validated or generated. */
export class ScenarioError extends Error {}

/** Committed generated artifacts do not match their recipes. */
export class ScenarioCheckError extends ScenarioError {}

/** A generated profile does not demonstrate its declared lesson. */
export class ScenarioAssertionError extends ScenarioError {}

/** Names the source checkout the repository-touching entry points read. */
export interface ScenarioRepositoryOptions {
  repositoryRoot: string;
}

export function loadScenarioJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    throw new ScenarioError(`cannot read ${path}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ScenarioError(`invalid JSON in ${path}: ${(error as Error).message}`);
  }
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8");
}

/** Python repr() for the error messages that quote values. */
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "string") {
    return `'${value}'`;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown | undefined): value is PlainRecord {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function utcEpochMs(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new ScenarioError(`${label}: invalid UTC instant ${pyRepr(value)}`);
  }
  const replaced = value.split("Z").join("+00:00");
  const match = ISO_INSTANT.exec(replaced);
  if (match === null) {
    throw new ScenarioError(`${label}: invalid UTC instant ${pyRepr(value)}`);
  }
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction,
    offsetSign,
    offsetHours,
    offsetMinutes,
    offsetSeconds,
  ] = match;
  if (offsetSign === undefined) {
    throw new ScenarioError(`${label}: instant must be UTC`);
  }
  const offset =
    (offsetSign === "-" ? -1 : 1) *
    (Number(offsetHours) * 3600 + Number(offsetMinutes) * 60 + Number(offsetSeconds ?? 0));
  if (offset !== 0) {
    throw new ScenarioError(`${label}: instant must be UTC`);
  }
  const milliseconds = fraction === undefined ? 0 : Math.trunc(Number(`0.${fraction}`) * 1000);
  const epoch = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    milliseconds,
  );
  const check = new Date(epoch);
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  ) {
    throw new ScenarioError(`${label}: invalid UTC instant ${pyRepr(value)}`);
  }
  return epoch;
}

function utcText(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19) + "Z";
}

const validatorCache = new Map<string, ValidateFunction>();

function validatorFor(schemaPath: string): ValidateFunction {
  const cached = validatorCache.get(schemaPath);
  if (cached !== undefined) {
    return cached;
  }
  const schema = loadScenarioJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(schema as object);
  } catch (error) {
    throw new ScenarioError(`invalid JSON Schema ${schemaPath}: ${(error as Error).message}`);
  }
  validatorCache.set(schemaPath, validate);
  return validate;
}

function schemaErrorLines(errors: readonly ErrorObject[]): string[] {
  const unique = new Set<string>();
  for (const error of errors) {
    unique.add(
      `${error.instancePath === "" ? "/" : error.instancePath}: ${error.message ?? "invalid"}`,
    );
  }
  return [...unique].sort().slice(0, 12);
}

/* The scenario-index contract (contract.ts) is the authority here;
   scenarios/index.schema.json is emitted FROM it by `mise run schemas`. */
function contractErrorLines(error: ZodError): string[] {
  const unique = new Set<string>();
  for (const issue of error.issues) {
    unique.add(`/${issue.path.join("/")}: ${issue.message}`);
  }
  return [...unique].sort().slice(0, 12);
}

export function validateScenarioIndex(index: unknown, source: string): void {
  const result = scenarioIndexSchema.safeParse(index as unknown);
  if (!result.success) {
    const details = contractErrorLines(result.error).join("\n  ");
    throw new ScenarioError(
      `${source} does not satisfy the scenario-index contract:\n  ${details}`,
    );
  }
}

/** The definition's capability declaration, typed through the contract it is copied into verbatim. */
function declaredCapabilities(definition: PlainRecord): ScenarioCapabilities {
  const scenarioId = definition["id"] as string;
  const result = scenarioCapabilitiesSchema.safeParse(definition["capabilities"]);
  if (!result.success) {
    const details = contractErrorLines(result.error).join("\n  ");
    throw new ScenarioError(
      `scenario ${scenarioId}: capabilities do not satisfy the scenario-index contract:\n  ${details}`,
    );
  }
  return result.data;
}

export function validateDefinition(
  definition: unknown,
  {
    repositoryRoot,
    source = "scenario definition",
  }: ScenarioRepositoryOptions & { source?: string },
): void {
  const root = repositoryRoot;
  const plain = definition as unknown as PlainRecord;
  const schemaPath = join(root, "scenarios", "scenario.schema.json");
  const validate = validatorFor(schemaPath);
  if (!validate(plain)) {
    const details = schemaErrorLines(validate.errors ?? []).join("\n  ");
    throw new ScenarioError(`${source} is invalid:\n  ${details}`);
  }

  const scenarioId = plain["id"] as string;
  const models = loadScenarioJson(packagedModelsPath()) as {
    models: Array<{ slug: string }>;
  };
  if (models.models.some((model) => model.slug === scenarioId)) {
    throw new ScenarioError(
      `scenario ${scenarioId}: id is a production model slug; use a synthetic identity`,
    );
  }

  const capabilities = declaredCapabilities(plain);
  const semantics = plain["semantics"] as PlainRecord;
  const gustSemantics = semantics["gust"] ?? null;
  const expectedGustSemantics = capabilities.gust !== false ? capabilities.gust : null;
  if (gustSemantics !== expectedGustSemantics) {
    throw new ScenarioError(
      `scenario ${scenarioId}: semantics.gust must exactly match capabilities.gust`,
    );
  }

  const smokeCapability = capabilities.smoke ?? false;
  const smokeSemantics = semantics["smoke"] ?? null;
  const expectedSmokeSemantics = smokeCapability !== false ? smokeCapability : null;
  if (smokeSemantics !== expectedSmokeSemantics) {
    throw new ScenarioError(
      `scenario ${scenarioId}: semantics.smoke must exactly match capabilities.smoke`,
    );
  }

  const hourCount = (plain["clock"] as PlainRecord)["hourCount"] as number;
  const kind = plain["kind"] as string;
  const variants = ((plain["comparison"] as PlainRecord | undefined)?.["variants"] ??
    []) as Array<PlainRecord>;
  const variantIds = new Set(variants.map((variant) => variant["id"] as string));
  if (variantIds.size !== variants.length) {
    throw new ScenarioError(`scenario ${scenarioId}: comparison variant ids must be unique`);
  }
  (plain["transforms"] as PlainRecord[]).forEach((transform, index) => {
    const label = `scenario ${scenarioId} transform ${index} (${transform["type"]})`;
    const target = transform["target"];
    if (kind === "comparison") {
      if (target !== undefined && !variantIds.has(target as string)) {
        throw new ScenarioError(`${label}: unknown comparison target ${pyRepr(target)}`);
      }
    } else if (target !== undefined) {
      throw new ScenarioError(`${label}: target is valid only for comparison scenarios`);
    }

    if ("altitudeBandM" in transform) {
      const band = transform["altitudeBandM"] as { bottomM: number; topM: number };
      if (band.topM <= band.bottomM) {
        throw new ScenarioError(`${label}: altitudeBandM.topM must be greater than bottomM`);
      }
    }
    if ("atHours" in transform) {
      validateHourOffsets(transform["atHours"] as number[], hourCount, `${label}.atHours`);
    }
    if ("points" in transform) {
      validatePoints(transform["points"] as PlainRecord[], hourCount, `${label}.points`);
    }
    for (const name of ["offsetC", "factor", "degrees", "value"]) {
      const scheduled = transform[name];
      if (isRecord(scheduled)) {
        validatePoints(scheduled["byHour"] as PlainRecord[], hourCount, `${label}.${name}.byHour`);
      }
    }
  });

  for (const assertion of plain["assertions"] as PlainRecord[]) {
    const references: PlainRecord[] = [assertion["actual"] as PlainRecord];
    if (isRecord(assertion["expected"])) {
      references.push(assertion["expected"] as PlainRecord);
    }
    for (const reference of references) {
      const target = reference["target"];
      const label = `scenario ${scenarioId} assertion ${assertion["id"]}`;
      if (kind === "comparison") {
        if (!variantIds.has(target as string)) {
          throw new ScenarioError(
            `${label}: comparison metric reference must target a known variant`,
          );
        }
      } else if (target !== undefined) {
        throw new ScenarioError(`${label}: target is valid only for comparison scenarios`);
      }
    }
  }
}

function validateHourOffsets(offsets: readonly number[], hourCount: number, label: string): void {
  const counts = new Map<number, number>();
  for (const offset of offsets) {
    counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([offset]) => offset)
    .sort((a, b) => a - b);
  if (duplicates.length > 0) {
    throw new ScenarioError(`${label}: duplicate hour offsets [${duplicates.join(", ")}]`);
  }
  const outside = offsets.filter((offset) => offset >= hourCount);
  if (outside.length > 0) {
    throw new ScenarioError(
      `${label}: hour offsets [${outside.join(", ")}] exceed clock.hourCount ${hourCount}`,
    );
  }
}

function validatePoints(points: readonly PlainRecord[], hourCount: number, label: string): void {
  validateHourOffsets(
    points.map((point) => point["hourOffset"] as number),
    hourCount,
    label,
  );
}

function containsKey(value: unknown, prohibited: string): boolean {
  if (isPlainRecord(value)) {
    return (
      prohibited in value || Object.values(value).some((item) => containsKey(item, prohibited))
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, prohibited));
  }
  return false;
}

function requireFields(value: PlainRecord, fields: readonly string[], label: string): void {
  const missing = fields.filter((field) => !(field in value));
  if (missing.length > 0) {
    throw new ScenarioError(`${label}: missing required source fields ['${missing.join("', '")}']`);
  }
}

export function loadBaseline(definition: unknown, repositoryRoot: string): PlainRecord {
  const def = definition as PlainRecord;
  const scenarioId = (def["id"] as string) ?? "<unknown>";
  const baselineBlock = def["baseline"] as PlainRecord;
  const scenariosRoot = join(repositoryRoot, "scenarios");
  const path = join(scenariosRoot, baselineBlock["path"] as string);
  if (relative(resolve(scenariosRoot), resolve(path)).startsWith("..")) {
    throw new ScenarioError(`scenario ${scenarioId}: baseline escapes scenarios/`);
  }
  const baseline = loadScenarioJson(path);
  if (!isPlainRecord(baseline)) {
    throw new ScenarioError(`scenario ${scenarioId}: baseline must be a JSON object`);
  }
  if (containsKey(baseline, "derived")) {
    throw new ScenarioError(
      `scenario ${scenarioId}: baseline ${baselineBlock["path"]} authors derived values`,
    );
  }
  if ("siteAltitudeM" in baseline) {
    throw new ScenarioError(
      `scenario ${scenarioId}: baseline ${baselineBlock["path"]} ` +
        "carries siteAltitudeM — derivation inputs have been launch-agnostic " +
        "since the launch decoupling: delete the field and declare the launch " +
        "in the definition's launch block instead",
    );
  }
  if (baselineBlock["type"] === "calibrated") {
    const provenance = join(scenariosRoot, baselineBlock["provenancePath"] as string);
    let isFile = false;
    try {
      isFile = statSync(provenance).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      throw new ScenarioError(
        `scenario ${scenarioId}: calibrated baseline provenance is missing: ${provenance}`,
      );
    }
    loadScenarioJson(provenance);
  }
  return baseline;
}

export function prepareSource(definition: unknown, baseline: unknown): PlainRecord {
  const def = definition as PlainRecord;
  const scenarioId = def["id"] as string;
  const baselineRecord = baseline as PlainRecord;
  requireFields(
    baselineRecord,
    [
      "referenceTime",
      "generatedAt",
      "siteId",
      "siteName",
      "latitude",
      "longitude",
      "modelElevationM",
      "hours",
    ],
    `scenario ${scenarioId} baseline`,
  );
  const baselineHours = baselineRecord["hours"];
  const clock = def["clock"] as PlainRecord;
  const hourCount = clock["hourCount"] as number;
  if (!Array.isArray(baselineHours) || baselineHours.length !== hourCount) {
    const count = Array.isArray(baselineHours) ? baselineHours.length : "non-array";
    throw new ScenarioError(
      `scenario ${scenarioId}: baseline has ${count} hours, expected clock.hourCount ${hourCount}`,
    );
  }

  const site = def["site"] as PlainRecord;
  const start = utcEpochMs(clock["startAt"], `scenario ${scenarioId} clock.startAt`);
  const stepMs = (clock["stepHours"] as number) * 3600_000;
  const source = structuredClone(baseline) as PlainRecord;
  Object.assign(source, {
    referenceTime: clock["referenceTime"],
    generatedAt: clock["generatedAt"],
    siteId: site["id"],
    siteName: site["name"],
    latitude: site["latitude"],
    longitude: site["longitude"],
    modelElevationM: site["modelElevationM"],
    siteTimeZone: def["timeZone"],
  });
  (source["hours"] as unknown[]).forEach((hour, index) => {
    if (!isPlainRecord(hour)) {
      throw new ScenarioError(`scenario ${scenarioId} baseline hour ${index}: must be an object`);
    }
    hour["validAt"] = utcText(start + index * stepMs);
  });
  return source;
}

function scheduledValue(schedule: unknown, hour: number): number {
  if (!isPlainRecord(schedule)) {
    return schedule as number;
  }
  const points = [...(schedule["byHour"] as PlainRecord[])].sort(
    (a, b) => (a["hourOffset"] as number) - (b["hourOffset"] as number),
  );
  const offsetOf = (point: PlainRecord) => point["hourOffset"] as number;
  const valueOf = (point: PlainRecord) => point["value"] as number;
  if (hour <= offsetOf(points[0])) {
    return valueOf(points[0]);
  }
  if (hour >= offsetOf(points[points.length - 1])) {
    return valueOf(points[points.length - 1]);
  }
  for (let index = 1; index < points.length; index += 1) {
    const below = points[index - 1];
    const above = points[index];
    if (offsetOf(below) <= hour && hour <= offsetOf(above)) {
      const fraction = (hour - offsetOf(below)) / (offsetOf(above) - offsetOf(below));
      return valueOf(below) + fraction * (valueOf(above) - valueOf(below));
    }
  }
  throw new Error("scheduled points did not bracket the validated hour");
}

function isSelected(transform: PlainRecord, hour: number): boolean {
  if (!("atHours" in transform)) {
    return true;
  }
  return (transform["atHours"] as unknown[]).some((offset) => (offset as number) === hour);
}

function inBand(altitudeM: number, transform: PlainRecord): boolean {
  const band = transform["altitudeBandM"] as PlainRecord;
  return (band["bottomM"] as number) <= altitudeM && altitudeM <= (band["topM"] as number);
}

const LEVEL_TRANSFORM_FIELDS: Record<string, [string, string]> = {
  "temperature-offset": ["temperatureC", "offsetC"],
  "dew-point-depression-offset": ["dewPointDepressionC", "offsetC"],
  "wind-speed-scale": ["windSpeedMps", "factor"],
  "wind-direction-rotate": ["windDirectionDeg", "degrees"],
};

function applyLevelTransform(transform: PlainRecord, source: PlainRecord): void {
  const operation = transform["type"] as string;
  const [field, operand] = LEVEL_TRANSFORM_FIELDS[operation];
  (source["hours"] as PlainRecord[]).forEach((hour, index) => {
    if (!isSelected(transform, index)) {
      return;
    }
    const amount = scheduledValue(transform[operand], index);
    const apply = (container: PlainRecord) => {
      const current = container[field] as number;
      container[field] = operation === "wind-speed-scale" ? current * amount : current + amount;
    };
    for (const level of hour["levels"] as PlainRecord[]) {
      if (inBand(level["heightM"] as number, transform)) {
        apply(level);
      }
    }
    if (transform["includeSurface"] && inBand(source["modelElevationM"] as number, transform)) {
      apply(hour);
    }
  });
}

function applyCapabilityField(
  transform: PlainRecord,
  definition: PlainRecord,
  source: PlainRecord,
): void {
  const path = transform["field"] as string;
  const dot = path.indexOf(".");
  const block = path.slice(0, dot);
  const field = path.slice(dot + 1);
  const capabilities = definition["capabilities"] as PlainRecord;
  const verticalLevels = new Set(
    ((capabilities["verticalVelocityLevels"] as unknown[] | undefined) ?? []).map(
      (level) => level as number,
    ),
  );
  (source["hours"] as PlainRecord[]).forEach((hour, index) => {
    if (!isSelected(transform, index)) {
      return;
    }
    const containers = block === "surface" ? [hour] : (hour["levels"] as PlainRecord[]);
    for (const container of containers) {
      if (
        field === "verticalVelocityPaS" &&
        !verticalLevels.has(container["pressureHpa"] as number)
      ) {
        delete container[field];
        continue;
      }
      if (transform["action"] === "omit") {
        delete container[field];
      } else {
        container[field] = scheduledValue(transform["value"], index);
      }
    }
  });
}

export function applyTransforms(definition: unknown, source: PlainRecord): void {
  const def = definition as PlainRecord;
  for (const transformValue of def["transforms"] as unknown[]) {
    const transform = transformValue as PlainRecord;
    const operation = transform["type"] as string;
    if (operation === "surface-field-curve") {
      (source["hours"] as PlainRecord[]).forEach((hour, index) => {
        hour[transform["field"] as string] = scheduledValue(
          { byHour: transform["points"] } as unknown,
          index,
        );
      });
    } else if (operation in LEVEL_TRANSFORM_FIELDS) {
      applyLevelTransform(transform, source);
    } else if (operation === "pressure-tendency") {
      const clock = def["clock"] as PlainRecord;
      const stepHours = clock["stepHours"] as number;
      const hpaPerHour = transform["hpaPerHour"] as number;
      (source["hours"] as PlainRecord[]).forEach((hour, index) => {
        const current = hour["seaLevelPressureHpa"] as number;
        const delta = hpaPerHour * index * stepHours;
        hour["seaLevelPressureHpa"] = current + delta;
      });
    } else if (operation === "capability-field") {
      applyCapabilityField(transform, def, source);
    } else if (operation === "time-shift") {
      const deltaMs = (transform["hours"] as number) * 3600_000;
      source["referenceTime"] = utcText(
        utcEpochMs(source["referenceTime"], "referenceTime") + deltaMs,
      );
      source["generatedAt"] = utcText(utcEpochMs(source["generatedAt"], "generatedAt") + deltaMs);
      for (const hour of source["hours"] as PlainRecord[]) {
        hour["validAt"] = utcText(utcEpochMs(hour["validAt"], "validAt") + deltaMs);
      }
    } else if (operation === "elevation-adjustment") {
      const current = source["modelElevationM"] as number;
      const delta = transform["modelElevationDeltaM"] as number;
      source["modelElevationM"] = current + delta;
    } else {
      throw new Error(`unhandled validated transform ${operation}`);
    }
  }
}

function definitionForVariant(definition: PlainRecord, variantId: string): PlainRecord {
  const selected = structuredClone(definition) as PlainRecord;
  const transforms: unknown[] = [];
  for (const transformValue of definition["transforms"] as unknown[]) {
    const transform = transformValue as PlainRecord;
    const target = transform["target"];
    if (target !== undefined && target !== variantId) {
      continue;
    }
    const operation = structuredClone(transform) as PlainRecord;
    delete operation["target"];
    transforms.push(operation);
  }
  selected["transforms"] = transforms;
  return selected;
}

function perturbationGroup(
  correlation: string,
  hourIndex: number,
  level: PlainRecord | null,
): string {
  if (correlation === "whole-column") {
    return "column";
  }
  if (correlation === "by-hour") {
    return `hour:${hourIndex}`;
  }
  if (correlation === "by-level") {
    return level === null ? "surface" : `level:${String(level["pressureHpa"] as number)}`;
  }
  return level === null
    ? `surface:${hourIndex}`
    : `level:${hourIndex}:${String(level["pressureHpa"] as number)}`;
}

function stableRandom(seed: unknown, ...coordinates: unknown[]) {
  return randomFromMaterial(JSON.stringify([seed, ...coordinates]));
}

function symmetricCoordinate(
  seed: unknown,
  perturbationIndex: number,
  group: string,
  memberIndex: number,
  memberCount: number,
): number {
  const ranks = Array.from({ length: memberCount }, (_, index) => index);
  stableRandom(seed, "symmetric", perturbationIndex, group).shuffle(ranks);
  const rank = ranks[memberIndex];
  return -1.0 + (2.0 * rank) / (memberCount - 1);
}

function perturbationDelta(
  perturbation: PlainRecord,
  seed: unknown,
  perturbationIndex: number,
  group: string,
  memberIndex: number,
  memberCount: number,
): number {
  const distribution = perturbation["distribution"] as string;
  const spread = perturbation["spread"] as number;
  let coordinate: number;
  if (distribution === "symmetric") {
    coordinate = symmetricCoordinate(seed, perturbationIndex, group, memberIndex, memberCount);
  } else {
    const stream = stableRandom(seed, distribution, perturbationIndex, group, memberIndex);
    coordinate = distribution === "normal" ? stream.gauss(0.0, 1.0) : stream.uniform(-1.0, 1.0);
  }
  return spread * coordinate;
}

export function applyMemberPerturbations(
  definition: unknown,
  source: PlainRecord,
  memberIndex: number,
): void {
  const def = definition as PlainRecord;
  const ensemble = def["ensemble"] as PlainRecord;
  const memberCount = ensemble["members"] as number;
  const seed = (def["clock"] as PlainRecord)["seed"] as unknown;
  (ensemble["perturbations"] as PlainRecord[]).forEach((perturbation, perturbationIndex) => {
    const path = perturbation["field"] as string;
    const dot = path.indexOf(".");
    const block = path.slice(0, dot);
    const field = path.slice(dot + 1);
    (source["hours"] as PlainRecord[]).forEach((hour, hourIndex) => {
      const containers = block === "surface" ? [hour] : (hour["levels"] as PlainRecord[]);
      for (const container of containers) {
        const group = perturbationGroup(
          perturbation["correlation"] as string,
          hourIndex,
          block === "levels" ? container : null,
        );
        const delta = perturbationDelta(
          perturbation,
          seed,
          perturbationIndex,
          group,
          memberIndex,
          memberCount,
        );
        container[field] = (container[field] as number) + delta;
      }
    });
  });
}

function finiteNumber(value: unknown | undefined, label: string): number {
  if (
    typeof value === "boolean" ||
    value === null ||
    value === undefined ||
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new ScenarioError(`${label}: expected a finite number, got ${pyRepr(value ?? null)}`);
  }
  return value;
}

function controlledSupersaturation(definition: PlainRecord): boolean {
  const exceptions = (definition["physicalExceptions"] ?? []) as PlainRecord[];
  return exceptions.some((exception) => exception["type"] === "controlled-supersaturation");
}

export function validateSource(definition: unknown, source: PlainRecord): void {
  const plainDefinition = definition as unknown as PlainRecord;
  const scenarioId = plainDefinition["id"] as string;
  const modelElevation = finiteNumber(
    source["modelElevationM"],
    `scenario ${scenarioId} model elevation`,
  );
  let previousTime: number | null = null;
  const allowSupersaturation = controlledSupersaturation(plainDefinition);
  (source["hours"] as PlainRecord[]).forEach((hour, hourIndex) => {
    const label = `scenario ${scenarioId} hour ${hourIndex}`;
    requireFields(hour, BASE_SOURCE_FIELDS, label);
    const validAt = utcEpochMs(hour["validAt"], `${label}.validAt`);
    if (previousTime !== null && validAt <= previousTime) {
      throw new ScenarioError(`${label}: hours must be strictly chronological`);
    }
    previousTime = validAt;
    for (const field of BASE_SOURCE_FIELDS.slice(0, -1)) {
      finiteNumber(hour[field], `${label}.${field}`);
    }
    if ((hour["seaLevelPressureHpa"] as number) <= 0) {
      throw new ScenarioError(`${label}.seaLevelPressureHpa: pressure must be positive`);
    }
    if ((hour["windSpeedMps"] as number) < 0) {
      throw new ScenarioError(`${label}.windSpeedMps: wind speed must be non-negative`);
    }
    if ((hour["dewPointDepressionC"] as number) < 0 && !allowSupersaturation) {
      throw new ScenarioError(
        `${label}: dew point exceeds temperature; declare controlled-supersaturation to test this edge case`,
      );
    }
    if (!Array.isArray(hour["levels"])) {
      throw new ScenarioError(`${label}.levels: expected an array`);
    }
    const ordered = [...(hour["levels"] as PlainRecord[])].sort((a, b) => {
      const heightOf = (level: PlainRecord) =>
        typeof level["heightM"] === "number" ? level["heightM"] : Infinity;
      return heightOf(a) - heightOf(b);
    });
    let previousHeight: number | null = null;
    let previousPressure: number | null = null;
    ordered.forEach((level, levelIndex) => {
      const levelLabel = `${label} level ${levelIndex}`;
      requireFields(level, BASE_LEVEL_FIELDS, levelLabel);
      for (const field of BASE_LEVEL_FIELDS) {
        finiteNumber(level[field], `${levelLabel}.${field}`);
      }
      if ((level["windSpeedMps"] as number) < 0) {
        throw new ScenarioError(`${levelLabel}.windSpeedMps: wind speed must be non-negative`);
      }
      if ((level["dewPointDepressionC"] as number) < 0 && !allowSupersaturation) {
        throw new ScenarioError(
          `${levelLabel}: dew point exceeds temperature; declare controlled-supersaturation to test this edge case`,
        );
      }
      const heightM = level["heightM"] as number;
      const pressureHpa = level["pressureHpa"] as number;
      if (
        previousHeight !== null &&
        (heightM <= previousHeight || pressureHpa >= (previousPressure as number))
      ) {
        throw new ScenarioError(
          `${levelLabel}: pressure must strictly decrease as level height increases ` +
            `(previous ${previousPressure} hPa at ${previousHeight} m, actual ` +
            `${pressureHpa} hPa at ${heightM} m)`,
        );
      }
      previousHeight = heightM;
      previousPressure = pressureHpa;
    });
    if (!ordered.some((level) => (level["heightM"] as number) > modelElevation + 20)) {
      throw new ScenarioError(
        `${label}: no pressure level remains above model terrain after filtering`,
      );
    }
  });
  validateCapabilities(plainDefinition, source);
}

function validateCapabilities(definition: PlainRecord, source: PlainRecord): void {
  const scenarioId = definition["id"] as string;
  const capabilities = declaredCapabilities(definition);
  const modelElevation = source["modelElevationM"] as number;
  (source["hours"] as PlainRecord[]).forEach((hour, hourIndex) => {
    const label = `scenario ${scenarioId} hour ${hourIndex} capability`;
    const retained = (hour["levels"] as PlainRecord[]).filter(
      (level) => (level["heightM"] as number) > modelElevation + 20,
    );
    const expectedPressures = capabilities.levels ? capabilities.pressureLevels : [];
    const actualPressures = [...retained]
      .sort((a, b) => (b["pressureHpa"] as number) - (a["pressureHpa"] as number))
      .map((level) => level["pressureHpa"] as number);
    if (
      actualPressures.length !== expectedPressures.length ||
      actualPressures.some((pressure, index) => pressure !== expectedPressures[index])
    ) {
      throw new ScenarioError(
        `${label}: declared pressureLevels [${expectedPressures.join(", ")}] do not match retained source levels [${actualPressures.join(", ")}]`,
      );
    }
    if (!capabilities.heatFluxes) {
      throw new ScenarioError(
        `${label}: derive_site_forecast requires heat-flux source fields; this shape cannot declare heatFluxes false`,
      );
    }
    for (const [path, capability] of Object.entries(SURFACE_OPTIONAL_CAPABILITIES)) {
      const field = path.slice(path.indexOf(".") + 1);
      const expected = capabilities[capability] !== false;
      if (field in hour !== expected) {
        throw new ScenarioError(
          `${label}: ${field} presence does not match capabilities.${capability}`,
        );
      }
    }
    for (const field of CLOUD_LAYER_FIELDS) {
      if (field in hour !== capabilities.cloudLayers) {
        throw new ScenarioError(
          `${label}: ${field} presence does not match capabilities.cloudLayers`,
        );
      }
    }
    if ("smoke" in hour !== ((capabilities.smoke ?? false) !== false)) {
      throw new ScenarioError(`${label}: smoke presence does not match capabilities.smoke`);
    }
    const verticalExpected = new Set(capabilities.verticalVelocityLevels ?? []);
    for (const level of retained) {
      const pressureHpa = level["pressureHpa"] as number;
      const expected = capabilities.verticalVelocity !== false && verticalExpected.has(pressureHpa);
      if ("verticalVelocityPaS" in level !== expected) {
        throw new ScenarioError(
          `${label}: verticalVelocityPaS presence at ${pressureHpa} hPa does not match capabilities`,
        );
      }
      if ("cloudFractionPercent" in level !== capabilities.cloudProfile) {
        throw new ScenarioError(
          `${label}: cloudFractionPercent presence at ${pressureHpa} hPa does not match capabilities.cloudProfile`,
        );
      }
    }
  });
}

function validateProfile(definition: PlainRecord, profile: PlainRecord): void {
  const scenarioId = definition["id"] as string;
  const schemaPath = fileURLToPath(
    import.meta.resolve("@azohra/meteo.briefing/schema/profile.schema.json"),
  );
  const validate = validatorFor(schemaPath);
  if (!validate(profile)) {
    const details = schemaErrorLines(validate.errors ?? []).join("\n  ");
    throw new ScenarioError(
      `scenario ${scenarioId}: generated profile is contract-invalid:\n  ${details}`,
    );
  }
  if (profile["model"] !== scenarioId) {
    throw new ScenarioError(
      `scenario ${scenarioId}: generated profile has unexpected model identity`,
    );
  }
  if (!isDeepStrictEqual(profile["semantics"], definition["semantics"])) {
    throw new ScenarioError(
      `scenario ${scenarioId}: generated profile does not preserve declared transport semantics`,
    );
  }
  const run = profile["run"] as PlainRecord;
  if (definition["kind"] === "ensemble") {
    if (run["members"] !== (definition["ensemble"] as PlainRecord)["members"]) {
      throw new ScenarioError(
        `scenario ${scenarioId}: generated run member count does not match the definition`,
      );
    }
    validateEnsembleProfile(definition, profile);
    return;
  }
  if ("members" in run) {
    throw new ScenarioError(`scenario ${scenarioId}: deterministic run declares ensemble members`);
  }
  let previousTime: number | null = null;
  const allowSupersaturation = controlledSupersaturation(definition);
  const modelElevation = (profile["site"] as PlainRecord)["modelElevationM"] as number;
  (profile["hours"] as PlainRecord[]).forEach((hour, hourIndex) => {
    const validAt = utcEpochMs(hour["validAt"], `scenario ${scenarioId} hour ${hourIndex}.validAt`);
    if (previousTime !== null && validAt <= previousTime) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: hours are not chronological`,
      );
    }
    previousTime = validAt;
    const surface = hour["surface"] as PlainRecord;
    const surfaceDirection = surface["windDirectionDeg"] as number;
    if (
      (surface["windSpeedMps"] as number) < 0 ||
      !(0 <= surfaceDirection && surfaceDirection < 360)
    ) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: surface wind is not normalized and non-negative`,
      );
    }
    if (
      (surface["dewPointC"] as number) > (surface["temperatureC"] as number) &&
      !allowSupersaturation
    ) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: surface dew point exceeds temperature`,
      );
    }
    let previousHeight: number | null = null;
    let previousPressure: number | null = null;
    for (const level of hour["levels"] as PlainRecord[]) {
      const heightM = level["heightM"] as number;
      const pressureHpa = level["pressureHpa"] as number;
      if (heightM <= modelElevation) {
        throw new ScenarioError(
          `scenario ${scenarioId} hour ${hourIndex}: level at ${heightM} m is not above model terrain ${modelElevation} m`,
        );
      }
      if (
        previousHeight !== null &&
        (heightM <= previousHeight || pressureHpa >= (previousPressure as number))
      ) {
        throw new ScenarioError(
          `scenario ${scenarioId} hour ${hourIndex}: pressure does not decrease with level height`,
        );
      }
      const direction = level["windDirectionDeg"] as number;
      if ((level["windSpeedMps"] as number) < 0 || !(0 <= direction && direction < 360)) {
        throw new ScenarioError(
          `scenario ${scenarioId} hour ${hourIndex}: level wind is not normalized and non-negative`,
        );
      }
      if (
        (level["dewPointC"] as number) > (level["temperatureC"] as number) &&
        !allowSupersaturation
      ) {
        throw new ScenarioError(
          `scenario ${scenarioId} hour ${hourIndex}: level dew point exceeds temperature`,
        );
      }
      previousHeight = heightM;
      previousPressure = pressureHpa;
    }
    const derivedKeys = new Set(Object.keys(hour["derived"] as PlainRecord));
    const expectedDerived = [
      "boundaryLayerTopM",
      "thermalVelocityMps",
      "cloudBaseM",
      "usableLiftTopM",
    ];
    if (
      derivedKeys.size !== expectedDerived.length ||
      !expectedDerived.every((key) => derivedKeys.has(key))
    ) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: derived block is not authoritative`,
      );
    }
  });
}

export function* scenarioPercentileBlocks(
  value: unknown,
  path = "",
): Generator<[string, PlainRecord]> {
  if (isRecord(value)) {
    if (PERCENTILE_PATH_KEYS.every((key) => key in value)) {
      yield [path, value];
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      yield* scenarioPercentileBlocks(item, path ? `${path}.${key}` : key);
    }
  } else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      yield* scenarioPercentileBlocks(value[index], `${path}[${index}]`);
    }
  }
}

function validateEnsembleProfile(definition: PlainRecord, profile: PlainRecord): void {
  const scenarioId = definition["id"] as string;
  const declaredMembers = (definition["ensemble"] as PlainRecord)["members"] as number;
  const blocks = [...scenarioPercentileBlocks(profile["hours"])];
  if (blocks.length === 0) {
    throw new ScenarioError(`scenario ${scenarioId}: ensemble contains no percentile blocks`);
  }
  for (const [path, block] of blocks) {
    const contributors = block["members"] as number;
    if (!(0 <= contributors && contributors <= declaredMembers)) {
      throw new ScenarioError(
        `scenario ${scenarioId}: ${path} has ${contributors} contributors, ` +
          `outside the declared 0–${declaredMembers} member range`,
      );
    }
    const values = PERCENTILE_KEYS.map((key) => block[key] as number | null);
    let ordered: boolean;
    if (contributors === 0) {
      ordered = values.every((value) => value === null);
    } else {
      ordered =
        values.every((value) => value !== null) &&
        values.every(
          (value, index) => index === 0 || (values[index - 1] as number) <= (value as number),
        );
    }
    if (!ordered) {
      throw new ScenarioError(
        `scenario ${scenarioId}: percentile order fails at ${path}: [${values.join(", ")}]`,
      );
    }
    if (((block["ceiledMembers"] as number | undefined) ?? 0) > contributors) {
      throw new ScenarioError(`scenario ${scenarioId}: ceiledMembers exceeds members at ${path}`);
    }
  }

  let previousTime: number | null = null;
  const declaredOptional = declaredOptionalSurfaceScalars(definition);
  (profile["hours"] as PlainRecord[]).forEach((hour, hourIndex) => {
    const validAt = utcEpochMs(hour["validAt"], `scenario ${scenarioId} hour ${hourIndex}.validAt`);
    if (previousTime !== null && validAt <= previousTime) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: hours are not chronological`,
      );
    }
    previousTime = validAt;
    const surface = hour["surface"] as PlainRecord;
    const missingOptional = declaredOptional.filter((field) => !(field in surface));
    if (missingOptional.length > 0) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: ensemble aggregate drops ` +
          `declared optional surface fields ['${missingOptional.join("', '")}']`,
      );
    }
    const directions = [
      surface["windDirectionDeg"] as number,
      ...(hour["levels"] as PlainRecord[]).map((level) => level["windDirectionDeg"] as number),
    ];
    if (directions.some((direction) => !(0 <= direction && direction < 360))) {
      throw new ScenarioError(
        `scenario ${scenarioId} hour ${hourIndex}: ensemble wind direction is not normalized`,
      );
    }
  });
}

function levelHeightPosition(level: PlainRecord): number {
  let height = level["heightM"] as unknown;
  if (isRecord(height)) {
    height = height["p50"];
  }
  if (typeof height === "boolean" || typeof height !== "number") {
    throw new ScenarioAssertionError(
      `level at ${pyRepr(level["pressureHpa"])} hPa has no numeric height position`,
    );
  }
  return height;
}

export function splitMetricField(field: string): [string, string, string | null] {
  const dot = field.indexOf(".");
  const block = dot === -1 ? field : field.slice(0, dot);
  const name = dot === -1 ? "" : field.slice(dot + 1);
  const lastDot = name.lastIndexOf(".");
  if (lastDot !== -1) {
    const head = name.slice(0, lastDot);
    const tail = name.slice(lastDot + 1);
    if (head && (PERCENTILE_PATH_KEYS as readonly string[]).includes(tail)) {
      return [block, head, tail];
    }
  }
  return [block, name, null];
}

export function resolveMetric(
  profile: PlainRecord,
  reference: PlainRecord,
  launch?: PlainRecord | null,
): [boolean, unknown] {
  const field = reference["field"] as string;
  const [block, name, percentile] = splitMetricField(field);
  let container: PlainRecord;
  if (block === "launch") {
    container = launch ?? {};
  } else if (block === "site") {
    container = profile["site"] as PlainRecord;
  } else {
    const hourIndex = reference["hour"] as number;
    const hours = profile["hours"] as PlainRecord[];
    if (hourIndex >= hours.length) {
      throw new ScenarioAssertionError(`hour ${hourIndex} is outside generated profile`);
    }
    const hour = hours[hourIndex];
    if (block === "surface" || block === "derived") {
      container = hour[block] as PlainRecord;
    } else if (block === "smoke") {
      container = (hour["smoke"] as PlainRecord | undefined) ?? {};
    } else {
      const levels = hour["levels"] as PlainRecord[];
      const selector = reference["level"] as PlainRecord;
      if ("pressureHpa" in selector) {
        const matches = levels.filter((level) => level["pressureHpa"] === selector["pressureHpa"]);
        if (matches.length === 0) {
          throw new ScenarioAssertionError(
            `hour ${hourIndex} has no level at ${selector["pressureHpa"]} hPa`,
          );
        }
        container = matches[0];
      } else {
        if (levels.length === 0) {
          throw new ScenarioAssertionError(`hour ${hourIndex} has no levels`);
        }
        const target = selector["nearestHeightM"] as number;
        container = levels.reduce((best, level) =>
          Math.abs(levelHeightPosition(level) - target) <
          Math.abs(levelHeightPosition(best) - target)
            ? level
            : best,
        );
      }
    }
  }
  const present = name in container;
  const value = container[name];
  if (percentile === null) {
    return [present, value];
  }
  if (!present) {
    return [false, undefined];
  }
  if (!isRecord(value) || !(percentile in value)) {
    throw new ScenarioAssertionError(
      `field ${field}: ${block}.${name} is not an ensemble percentile block`,
    );
  }
  return [true, value[percentile]];
}

function assertionContext(assertion: PlainRecord): string {
  const reference = assertion["actual"] as PlainRecord;
  const hour = "hour" in reference ? reference["hour"] : "site";
  return `hour ${hour}, field ${reference["field"]}`;
}

function profileForReference(
  definition: PlainRecord,
  profiles: PlainRecord,
  reference: PlainRecord,
): PlainRecord {
  if (definition["kind"] !== "comparison") {
    return profiles;
  }
  return profiles[reference["target"] as string] as PlainRecord;
}

type RelationalOperator = (actual: number, expected: number, tolerance: number) => boolean;

const RELATIONAL_OPERATORS: Record<string, RelationalOperator> = {
  equal: (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance,
  "not-equal": (actual, expected, tolerance) => Math.abs(actual - expected) > tolerance,
  "greater-than": (actual, expected, tolerance) => actual > expected + tolerance,
  "greater-than-or-equal": (actual, expected, tolerance) => actual >= expected - tolerance,
  "less-than": (actual, expected, tolerance) => actual < expected - tolerance,
  "less-than-or-equal": (actual, expected, tolerance) => actual <= expected + tolerance,
};

export function evaluateAssertions(definition: PlainRecord, profiles: PlainRecord): void {
  const scenarioId = definition["id"] as string;
  const launch = definition["launch"] as PlainRecord | undefined;
  for (const assertion of definition["assertions"] as PlainRecord[]) {
    const context = assertionContext(assertion);
    const assertionId = assertion["id"] as string;
    let present: boolean;
    let actual: unknown;
    try {
      const profile = profileForReference(definition, profiles, assertion["actual"] as PlainRecord);
      [present, actual] = resolveMetric(profile, assertion["actual"] as PlainRecord, launch);
    } catch (error) {
      if (error instanceof ScenarioAssertionError) {
        throw new ScenarioAssertionError(
          `scenario ${scenarioId} assertion ${assertionId} (${context}): ${error.message}`,
        );
      }
      throw error;
    }
    const operator = assertion["operator"] as string;
    if (operator === "present" || operator === "absent") {
      const passed = operator === "present" ? present : !present;
      if (!passed) {
        throw new ScenarioAssertionError(
          `scenario ${scenarioId} assertion ${assertionId} (${context}): ` +
            `expected ${operator}, actual ${pyRepr(actual)}`,
        );
      }
      continue;
    }
    if (!present) {
      throw new ScenarioAssertionError(
        `scenario ${scenarioId} assertion ${assertionId} (${context}): ` +
          `expected relation ${operator}, actual field is absent`,
      );
    }
    const expectedSpec = assertion["expected"];
    let expected: unknown;
    if (isRecord(expectedSpec)) {
      let expectedPresent: boolean;
      try {
        const expectedProfile = profileForReference(definition, profiles, expectedSpec);
        [expectedPresent, expected] = resolveMetric(expectedProfile, expectedSpec, launch);
      } catch (error) {
        if (error instanceof ScenarioAssertionError) {
          throw new ScenarioAssertionError(
            `scenario ${scenarioId} assertion ${assertionId} (${context}): ` +
              `expected reference: ${error.message}`,
          );
        }
        throw error;
      }
      if (!expectedPresent) {
        throw new ScenarioAssertionError(
          `scenario ${scenarioId} assertion ${assertionId} (${context}): expected field is absent`,
        );
      }
    } else {
      expected = expectedSpec;
    }
    if (typeof actual !== "number" || typeof expected !== "number") {
      throw new ScenarioAssertionError(
        `scenario ${scenarioId} assertion ${assertionId} (${context}): ` +
          `expected numeric relation ${operator}, actual ${pyRepr(actual)}, expected ${pyRepr(expected)}`,
      );
    }
    let passed: boolean;
    let expectedRelation: string;
    if (operator === "absolute-difference-at-least") {
      const threshold = assertion["threshold"] as number;
      passed = Math.abs(actual - expected) >= threshold;
      expectedRelation = `absolute difference >= ${threshold} from ${pyRepr(expected)}`;
    } else {
      const tolerance = (assertion["tolerance"] as number | undefined) ?? 0;
      passed = RELATIONAL_OPERATORS[operator](actual, expected, tolerance);
      expectedRelation = `${operator} ${pyRepr(expected)} (tolerance ${tolerance})`;
    }
    if (!passed) {
      throw new ScenarioAssertionError(
        `scenario ${scenarioId} assertion ${assertionId} (${context}): ` +
          `expected ${expectedRelation}, actual ${pyRepr(actual)}`,
      );
    }
  }
}

function deriveRaw(definition: PlainRecord, source: PlainRecord): PlainRecord {
  return deriveSiteForecast(
    source as unknown as SourceProfile,
    definition["id"] as string,
    definition["semantics"] as ForecastSemantics,
  ) as unknown as PlainRecord;
}

function generateDeterministicProfile(
  definition: PlainRecord,
  repositoryRoot: string,
): PlainRecord {
  const baseline = loadBaseline(definition, repositoryRoot);
  const source = prepareSource(definition, baseline);
  applyTransforms(definition, source);
  validateSource(definition, source);
  const profile = roundDocument(deriveRaw(definition, source)) as PlainRecord;
  validateProfile(definition, profile);
  return profile;
}

function declaredOptionalSurfaceScalars(definition: PlainRecord): string[] {
  const capabilities = declaredCapabilities(definition);
  const declared = Object.entries(SURFACE_OPTIONAL_CAPABILITIES)
    .filter(([, capability]) => capabilities[capability] !== false)
    .map(([path]) => path.slice(path.indexOf(".") + 1));
  if (capabilities.cloudLayers) {
    declared.push(...CLOUD_LAYER_FIELDS);
  }
  return declared;
}

function generateEnsembleProfile(definition: PlainRecord, repositoryRoot: string): PlainRecord {
  const baseline = loadBaseline(definition, repositoryRoot);
  const source = prepareSource(definition, baseline);
  applyTransforms(definition, source);
  const memberCount = (definition["ensemble"] as PlainRecord)["members"] as number;
  const rawMembers: PlainRecord[] = [];
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
    const memberSource = structuredClone(source) as PlainRecord;
    applyMemberPerturbations(definition, memberSource, memberIndex);
    validateSource(definition, memberSource);
    rawMembers.push(deriveRaw(definition, memberSource));
  }

  const first = rawMembers[0];
  const optionalScalars = declaredOptionalSurfaceScalars(definition);
  const surfaceScalars = [...ENSEMBLE_SURFACE_SCALARS, ...optionalScalars];
  const rawDoc: PlainRecord = {
    schemaVersion: first["schemaVersion"],
    model: definition["id"],
    run: { ...(first["run"] as PlainRecord), members: memberCount },
    site: first["site"],
    semantics: first["semantics"],
    hours: aggregateMemberProfiles(rawMembers as unknown as MemberProfile[], {
      surfaceScalars,
      optionalSurfaceScalars: optionalScalars,
    }),
  };
  const profile = roundDocument(rawDoc) as PlainRecord;
  validateProfile(definition, profile);
  evaluateAssertions(definition, profile);
  return profile;
}

function generateComparisonProfiles(
  definition: PlainRecord,
  repositoryRoot: string,
): Map<string, PlainRecord> {
  const baseline = loadBaseline(definition, repositoryRoot);
  const profiles = new Map<string, PlainRecord>();
  const variants = (definition["comparison"] as PlainRecord)["variants"] as PlainRecord[];
  for (const variant of variants) {
    const variantId = variant["id"] as string;
    const variantDefinition = definitionForVariant(definition, variantId);
    const source = prepareSource(variantDefinition, baseline);
    applyTransforms(variantDefinition, source);
    validateSource(variantDefinition, source);
    const profile = roundDocument(deriveRaw(definition, source)) as PlainRecord;
    validateProfile(definition, profile);
    profiles.set(variantId, profile);
  }
  evaluateAssertions(definition, Object.fromEntries(profiles));
  return profiles;
}

export function generateScenario(
  definition: unknown,
  { repositoryRoot }: ScenarioRepositoryOptions,
): PlainRecord {
  const record = definition as PlainRecord;
  const scenarioId = (record["id"] as string | undefined) ?? "<unknown>";
  if (record["kind"] === "comparison") {
    throw new ScenarioError(
      `scenario ${scenarioId}: comparison recipes produce multiple profiles; ` +
        "use generateScenarioRepository() (`mise run scenarios:generate`)",
    );
  }
  validateDefinition(record, { repositoryRoot, source: `scenario ${scenarioId}` });
  if (record["kind"] === "ensemble") {
    return generateEnsembleProfile(record, repositoryRoot);
  }
  const profile = generateDeterministicProfile(record, repositoryRoot);
  evaluateAssertions(record, profile);
  return profile;
}

interface OutputPayload {
  filename: string;
  payload: Buffer;
  metadata: { [key: string]: string };
}

function outputPayloads(definition: PlainRecord, repositoryRoot: string): OutputPayload[] {
  const scenarioId = definition["id"] as string;
  if (definition["kind"] === "comparison") {
    const profiles = generateComparisonProfiles(definition, repositoryRoot);
    const variants = (definition["comparison"] as PlainRecord)["variants"] as PlainRecord[];
    return variants.map((variant) => {
      const variantId = variant["id"] as string;
      return {
        filename: `${scenarioId}.${variantId}.profile.json`,
        payload: jsonBytes(profiles.get(variantId)!),
        metadata: { variant: variantId, title: variant["title"] as string },
      };
    });
  }
  return [
    {
      filename: `${scenarioId}.profile.json`,
      payload: jsonBytes(generateScenario(definition, { repositoryRoot })),
      metadata: {},
    },
  ];
}

export function buildScenarioArtifacts(repositoryRoot: string): {
  artifacts: Map<string, Buffer>;
  indexPayload: Buffer;
} {
  const definitionsDir = join(repositoryRoot, "scenarios", "definitions");
  const artifacts = new Map<string, Buffer>();
  const entries: Array<{ entry: PlainRecord; kind: string; id: string }> = [];
  const seenIds = new Set<string>();
  const definitionFiles = readdirSync(definitionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  for (const filename of definitionFiles) {
    const definitionPath = join(definitionsDir, filename);
    const definitionTagged = loadScenarioJson(definitionPath);
    if (!isPlainRecord(definitionTagged)) {
      throw new ScenarioError(`${definitionPath}: definition must be a JSON object`);
    }
    const definitionPlain = definitionTagged as PlainRecord;
    validateDefinition(definitionPlain, { repositoryRoot, source: definitionPath });
    const scenarioId = definitionPlain["id"] as string;
    if (seenIds.has(scenarioId)) {
      throw new ScenarioError(`duplicate scenario id ${pyRepr(scenarioId)}`);
    }
    seenIds.add(scenarioId);
    const payloads = outputPayloads(definitionTagged, repositoryRoot);
    const outputs: unknown[] = [];
    for (const { filename: outputName, payload, metadata } of payloads) {
      artifacts.set(outputName, payload);
      outputs.push({
        ...metadata,
        path: `generated/${outputName}`,
        sha256: createHash("sha256").update(payload).digest("hex"),
      });
    }
    const representative = JSON.parse(payloads[0].payload.toString("utf-8")) as PlainRecord;
    entries.push({
      kind: definitionPlain["kind"] as string,
      id: scenarioId,
      entry: {
        id: definitionTagged["id"],
        title: definitionTagged["title"],
        lesson: definitionTagged["lesson"],
        kind: definitionTagged["kind"],
        modelShape: definitionTagged["modelShape"],
        timeZone: definitionTagged["timeZone"],
        site: representative["site"],
        launch: definitionTagged["launch"],
        capabilities: definitionTagged["capabilities"],
        outputs,
      },
    });
  }
  const kindOrder: Record<string, number> = { deterministic: 0, ensemble: 1, comparison: 2 };
  entries.sort((a, b) => {
    const order = kindOrder[a.kind] - kindOrder[b.kind];
    if (order !== 0) {
      return order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const index = {
    schemaVersion: 1,
    scenarios: entries.map(({ entry }) => entry),
  };
  validateScenarioIndex(index, "generated scenario index");
  return { artifacts, indexPayload: jsonBytes(index) };
}

/**
 * Regenerates every discovered profile and the public scenario index;
 * `outputDir` redirects the writes away from `<root>/scenarios`.
 */
export function generateScenarioRepository({
  repositoryRoot,
  outputDir,
}: ScenarioRepositoryOptions & { outputDir?: string }): string[] {
  const root = repositoryRoot;
  const { artifacts, indexPayload } = buildScenarioArtifacts(root);
  const scenariosDir = outputDir ?? join(root, "scenarios");
  const generatedDir = join(scenariosDir, "generated");
  mkdirSync(generatedDir, { recursive: true });
  for (const stale of readdirSync(generatedDir)) {
    if (stale.endsWith(".profile.json") && !artifacts.has(stale)) {
      unlinkSync(join(generatedDir, stale));
    }
  }
  const written: string[] = [];
  for (const [filename, payload] of artifacts) {
    const path = join(generatedDir, filename);
    writeFileSync(path, payload);
    written.push(path);
  }
  const indexPath = join(scenariosDir, "index.json");
  writeFileSync(indexPath, indexPayload);
  return [...written.sort(), indexPath];
}

/** Fail without writing if committed scenario artifacts are stale or missing. */
export function checkScenarioRepository({ repositoryRoot }: ScenarioRepositoryOptions): void {
  const root = repositoryRoot;
  const { artifacts, indexPayload } = buildScenarioArtifacts(root);
  const indexPath = join(root, "scenarios", "index.json");
  let committedIndexExists = false;
  try {
    committedIndexExists = statSync(indexPath).isFile();
  } catch {
    committedIndexExists = false;
  }
  if (committedIndexExists) {
    validateScenarioIndex(loadScenarioJson(indexPath), "committed scenarios/index.json");
  }
  const generatedDir = join(root, "scenarios", "generated");
  const expected = new Map<string, Buffer>(
    [...artifacts.entries()].map(([filename, payload]) => [join(generatedDir, filename), payload]),
  );
  expected.set(indexPath, indexPayload);
  const problems: string[] = [];
  for (const [path, payload] of expected) {
    let committed: Buffer | null = null;
    try {
      committed = readFileSync(path);
    } catch {
      committed = null;
    }
    if (committed === null) {
      problems.push(`missing ${relative(root, path)}`);
    } else if (!committed.equals(payload)) {
      problems.push(`stale ${relative(root, path)}`);
    }
  }
  let committedOutputs: string[] = [];
  try {
    committedOutputs = readdirSync(generatedDir).filter((name) => name.endsWith(".profile.json"));
  } catch {
    committedOutputs = [];
  }
  for (const unmanaged of committedOutputs.filter((name) => !artifacts.has(name)).sort()) {
    problems.push(`unmanaged ${relative(root, join(generatedDir, unmanaged))}`);
  }
  if (problems.length > 0) {
    throw new ScenarioCheckError(
      "generated scenarios do not match their definitions:\n  " +
        problems.join("\n  ") +
        "\nrun `mise run scenarios:generate`",
    );
  }
}
