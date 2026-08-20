import type {
  CitedInstant,
  LocalDayKey,
  PercentileToken,
  QuietDayFinding,
} from "../analyze/index.js";

/** Options for one board: one local day, one zone. Default span 07:00–21:00 local, movable per call. */
export interface CompareBoardOptions {
  /** The local calendar day the board draws, `localDateKey`-shaped ("2026-08-09") in `timeZone`. */
  dateKey: string;
  /** IANA timezone — must equal every member analysis's own `timeZone`, because day keys pair only in one zone. */
  timeZone: string;
  /** First local hour on the axis, inclusive. Default 7. */
  dayStartHour?: number;
  /** Last local hour on the axis. Default 21. */
  dayEndHour?: number;
  /** Local hours given tick marks on the axis. Default [8, 12, 16, 20]. */
  tickHours?: ReadonlyArray<number>;
}

/** One labelled hour on the shared axis. */
export interface BoardTick {
  /** Local hour of day (h23). */
  hour: number;
  atMs: number;
  /** Fraction 0..1 of the day span. */
  x: number;
}

/** One local day resolved to UTC instants through Intl, never offset arithmetic. Consumers read fractions via `xForBoardTime`. */
export interface CompareBoardAxis {
  startMs: number;
  endMs: number;
  dayStartHour: number;
  dayEndHour: number;
  ticks: BoardTick[];
}

/** A cited instant placed on the axis: the finding's own instant plus its fraction of the day span. */
export interface BoardInstant {
  /** Fraction 0..1 of the day span (clamped at the axis edges). */
  x: number;
  atMs: number;
  at: CitedInstant;
}

/** A finding's run of hours on the axis. `endMs`/`x1` widen the last cited hour by the step (bar geometry only); `endCitedMs`/`x1Cited` stop at the last cited hour — words must use these. */
export interface BoardSpan {
  /** Fraction 0..1 at the first cited hour. */
  x0: number;
  /** Fraction 0..1 at the widened end (`endMs`) — bar geometry, never words. */
  x1: number;
  /** Fraction 0..1 at the cited end (`endCitedMs`) — where words stop. */
  x1Cited: number;
  startMs: number;
  /** `endCitedMs` plus the finding's own step — the covered span's far edge. */
  endMs: number;
  /** The finding's own last cited hour. */
  endCitedMs: number;
  start: CitedInstant;
  end: CitedInstant;
  /** The finding's cadence echo — the quantization bound on this span's timing. */
  stepHours: number;
}

/** One thermalWindow finding on the axis (windows touching the day appear even when they started the day before). */
export interface CompareBoardWindow extends BoardSpan {
  /** True when the edge is the document's own first/last hour — a data boundary ("open since at least" / "still open at"), never an opening or a decay. */
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
  peakLiftTopM: number;
  /** Null when the analysis ran without a launch. */
  peakLiftTopAboveLaunchM: number | null;
  peakThermalVelocityMps: number;
  /** Present when the window's own day is not this board's day (a midnight-spanning window) — its peaks describe the whole window, not this day's slice. */
  viaWindowFrom?: LocalDayKey;
}

/** Window hours at or above the caller's ceiling; thresholdMps echoes the caller's number (the package owns no safe-wind figure). No entry = no statement, never verified calm. */
export interface CompareBoardExceedance {
  quantity: "surfaceWind" | "gust" | "bandWind";
  /** The caller's ceiling (m/s), echoed verbatim from the finding. */
  thresholdMps: number;
  /** The document's declared gust class; present iff quantity is "gust". Never compare across classes. */
  gustSemantics?: "hourMax" | "instant";
  stepHours: number;
  runs: Array<BoardSpan & { peakMps: number; peakAt: BoardInstant }>;
}

/** Speed always; direction null where the analysis suppressed it under its own `directionFloorMps` (or the document published none). */
export interface BoardWindSample {
  directionDeg: number | null;
  speedMps: number;
}

/** Surface wind at window open, peak-lift hour, and close, m/s. Deterministic members only; ensembles publish no circular direction statistics. */
export interface CompareBoardLaunch {
  window: { start: CitedInstant; end: CitedInstant };
  start: BoardWindSample;
  peakLift: BoardWindSample & { at: BoardInstant };
  end: BoardWindSample;
  /** Circular start→end veer, positive clockwise; null when either endpoint's direction is suppressed. */
  netVeerDeg: number | null;
  /** The analysis's own floor under which a direction reads null. */
  directionFloorMps: number;
}

/** The day's strongest gust, m/s. hourMax and instant are different classes: label them and never compare across them. Null semantics: the document declares none. */
export interface CompareBoardGust {
  gustMps: number;
  meanWindMps: number | null;
  semantics: "hourMax" | "instant" | null;
  at: BoardInstant;
  /** "duringWindow" when the member's windSummary carries the window-scoped block; "wholeDay" otherwise. */
  scope: "duringWindow" | "wholeDay";
}

/** The aloft cell: the strongest wind at any level inside the climb band (windSummary's maxWindInBand), m/s. */
export interface CompareBoardAloft {
  windMps: number;
  directionDeg: number | null;
  heightM: number;
  at: BoardInstant;
  scope: "duringWindow" | "wholeDay";
  /** Whole-day scope only; the window-scoped block states no persistence. */
  persistenceHours: number | null;
}

/** The day's peak usable-lift top. `cloudCapped` true means the number IS cloud base; null when the day states no liftCeiling. */
export interface CompareBoardTop {
  liftTopM: number;
  /** Null when the analysis ran without a launch. */
  aboveLaunchM: number | null;
  at: BoardInstant;
  cloudCapped: boolean | null;
  cloudCappedHours: number;
  ceilingHours: number;
}

/** Storms cell as data. capTiming where the model publishes CIN, convectiveDay where CAPE alone; ensembles state nothing. capUnjudgeable = CAPE with no break time (absent CIN never reads "no cap"). CAPE magnitudes are model-specific; never compare across rows. */
export interface CompareBoardStorms {
  source: "capTiming" | "convectiveDay";
  verdict: "capBreaks" | "cappedAllDay" | "openButWeak" | "noInstability" | "capUnjudgeable";
  /** "multiHour" verdicts claim only the published steps, never the hours between. */
  cadence: "hourly" | "multiHour";
  stepHours: number;
  peakCapeJkg: number;
  peakCapeAt: BoardInstant | null;
  /** capBreaks only. "at": an hourly instant (span widened by the step); "between": somewhere between two adjacent published steps; "alreadyOpenAt": the day's first covered step is already open — a day edge, not a break timing. */
  capBreak: {
    kind: "at" | "between" | "alreadyOpenAt";
    x0: number;
    x1: number;
    startMs: number;
    endMs: number;
    start: CitedInstant;
    end: CitedInstant;
  } | null;
  capeAtBreakJkg: number | null;
  precipStartsAt: BoardInstant | null;
  peakPrecipMmHr: number | null;
  precipSemantics: "instantRate" | "windowMeanRate" | null;
  /** convectiveDay's honest positive: every covered hour's published rate sits at or under the floor. */
  noPrecipAboveThreshold: boolean;
}

/** "window"/"quiet" are votes. "abstained" is a data boundary; "benched" means published lift never reaches the launch, so launch-relative statements are structurally biased. */
export type CompareBoardVote =
  | {
      kind: "window";
      /** The member's same-day percentileCrossing token; null is the absence of a crossing (always for deterministic members), never a confidence claim. */
      minimalPassingPercentile: PercentileToken | null;
    }
  | {
      kind: "quiet";
      failed: QuietDayFinding["failed"];
      peakThermalVelocityMps: number | null;
      peakLiftDepthM: number | null;
    }
  | { kind: "abstained"; reason: "truncatedDay" | "outOfHorizon" }
  | { kind: "benched"; reason: "terrainMismatch"; deltaM: number };

/** One member's day on the shared axis. A null cell states nothing — print a dash, never treat it as calm. All wind values m/s; display conversion is the consumer's. */
export interface CompareBoardRow {
  /** `comparisonMemberKey(model, referenceTime)` — joins the comparison's ledger and `analyses` record. */
  member: string;
  model: string;
  referenceTime: string;
  kind: "deterministic" | "ensemble";
  /** The member's leading cadence echo (display fact; each span carries its own step). */
  stepHours: number;
  vote: CompareBoardVote;
  windows: CompareBoardWindow[];
  exceedances: CompareBoardExceedance[];
  /** True per quantity when an exceedance finding exists — absence is no statement (under the ceiling, or no ceiling supplied), never verified calm. */
  overCeiling: { surfaceWind: boolean; gust: boolean; bandWind: boolean };
  /** First hour precipitation exceeds the analysis's own floor, from whichever finding states it; null when no finding states one. */
  rainStart: (BoardInstant & { source: "capTiming" | "convectiveDay" | "quietDay" }) | null;
  launch: CompareBoardLaunch | null;
  gust: CompareBoardGust | null;
  aloft: CompareBoardAloft | null;
  top: CompareBoardTop | null;
  storms: CompareBoardStorms | null;
}

/** The whole board: one day, one axis, rows in comparison order (input order when no comparison was supplied). */
export interface CompareBoardScene {
  dateKey: LocalDayKey;
  timeZone: string;
  axis: CompareBoardAxis;
  rows: CompareBoardRow[];
}
