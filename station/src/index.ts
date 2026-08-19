export {
  STATION_SCHEMA_VERSION,
  UNAVAILABLE_REASONS,
  airConditionsSchema,
  capabilitiesSchema,
  declaredFavorableDirections,
  directionArcSchema,
  emptyConditions,
  historyPointSchema,
  historySchema,
  liveSampleSchema,
  liveSamplesSchema,
  parseStationCurrent,
  parseStationCurrentJson,
  parseStationFeed,
  parseStationFeedJson,
  parseStationLiveFrame,
  parseStationLiveFrameJson,
  readingSchema,
  recentSummarySchema,
  stationCurrentSchema,
  stationFeedSchema,
  stationLiveFrameSchema,
  stationMetaSchema,
  stationSchema,
  telemetrySchema,
  unavailableStation,
} from "./contract.js";
export type {
  AirConditions,
  History,
  HistoryPoint,
  LiveSample,
  LiveSamples,
  Reading,
  RecentSummary,
  Station,
  StationCapabilities,
  StationCurrent,
  StationFeed,
  StationLiveFrame,
  StationMeta,
  StationTelemetry,
  UnavailableReason,
} from "./contract.js";

export {
  CONNECTIVITY_SERVICE_STATES,
  connectivitySessionSchema,
  parseStationConnectivity,
  stationConnectivitySchema,
} from "./connectivity.js";
export type {
  ConnectivityServiceState,
  ConnectivitySession,
  StationConnectivity,
} from "./connectivity.js";

export {
  CALM_THRESHOLD_MPS,
  COMPASS_POINTS,
  compassDirection,
  freshness,
  isCalm,
  normalizeDegrees,
  periodSummary,
  pressureTendency,
  seaLevelPressureHpa,
  speedFromMps,
  speedToMps,
  speedUnitLabel,
  stationFreshnessThresholds,
  thresholdsToMps,
} from "./derive.js";
export type {
  CompassPoint,
  FreshnessStatus,
  FreshnessThresholds,
  PeriodSummary,
  PressureTendency,
  SpeedThresholds,
  SpeedUnit,
} from "./derive.js";

export { requireResolved, resolveDisplay, resolveStation } from "./display.js";
export type { DisplayDefaults, DisplayProps, ResolvedDisplay } from "./display.js";

export { currentEndpoint, feedEndpoint, liveEndpoint } from "./endpoints.js";

export {
  directionCell,
  optionalSpeed,
  roundSpeed,
  summaryEntries,
  temperatureText,
  temperatureValue,
  updatedAtText,
} from "./format.js";
export type { DirectionCellData, SummaryEntry } from "./format.js";

export {
  CHART_FALLBACK_WIDTH,
  DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  METEOROLOGICAL_SEASON_MONTHS,
  averagePoints,
  bandPoints,
  chartFrame,
  chartScales,
  compareTracePoints,
  compareWindow,
  dailyPattern,
  favorableShare,
  filterByMonth,
  filterByTimeOfDay,
  historyCoverage,
  historyGaps,
  meanDirectionDeg as historyMeanDirectionDeg,
  measuredChartWidth,
  nearestIndex,
  speedBand,
  thinVanes,
  tickAnchor,
  vanePath,
  vaneTicks,
  windRose,
  windowPoints,
} from "./geometry.js";
export type {
  ChartFrame,
  ChartScaleOptions,
  ChartScales,
  ChartTick,
  DailyPatternSlot,
  HistoryCoverage,
  RoseSector,
  TickAnchor,
  Vane,
  WindRoseSummary,
} from "./geometry.js";

export {
  DIAL_CARDINALS,
  DIAL_CARDINAL_TICK_INNER,
  DIAL_CENTRE,
  DIAL_COUNTERWEIGHT_RADIUS,
  DIAL_COUNTERWEIGHT_REACH,
  DIAL_HUB_RADIUS,
  DIAL_LETTER_RADIUS,
  DIAL_MIN_MAX_MPS,
  DIAL_RING_RADIUS,
  DIAL_SIZE,
  DIAL_TICK_INNER,
  ROSE_CARDINAL_LETTERS,
  ROSE_CENTRE,
  ROSE_FAVORABLE_RING_RADIUS,
  ROSE_HUB_DOT_RADIUS,
  ROSE_HUB_RADIUS,
  ROSE_INTERCARDINAL_BEARINGS,
  ROSE_LETTER_RADIUS,
  ROSE_MAX_RADIUS,
  ROSE_PETAL_FILL,
  ROSE_SIZE,
  ROSE_TICK_REACH,
  SPARKLINE_EDGE_INSET,
  SPARKLINE_MAX_PADDING,
  bandStrips,
  dialNeedlePoints,
  dialPolar,
  dialScaleMaxMps,
  dialSpeedArcPath,
  historyRuns,
  rosePetalPath,
  rosePolar,
  roseRingArcPath,
  sparklineScale,
} from "./instruments.js";
export type { FavorableDirection, HistoryRun } from "./instruments.js";

export { foldCurrent, mergeCurrent } from "./merge-current.js";
export type { MergeResult } from "./merge-current.js";

export {
  SAMPLE_GAP_TOLERANCE_FACTOR,
  sampleMeanDirectionDeg,
  samplePoints,
  sampleRuns,
  sampleScales,
  samplesSummary,
  thinSampleVanes,
} from "./samples.js";
export type { SamplesSummary } from "./samples.js";

export {
  defaultFormatTime,
  defaultStrings,
  localeFormatTime,
  mergeStringOverrides,
  resolveStrings,
} from "./strings.js";
export type { FormatTime, StationStringOverrides, StationStrings } from "./strings.js";

export { airRows, airSummary, lastStrikeWords } from "./air.js";
export type { AirRow } from "./air.js";

export { normalizeWindnerdStationKey, windnerdStationUrl } from "./windnerd.js";
