import type {
  CitedInstant,
  LocalDayKey,
  PercentileToken,
  QuietDayFinding,
} from "../analyze/index.js";

/**
 * Options for one board: a single local day, resolved in one zone. The
 * day span mirrors the Meteogram's display window (07:00–21:00 local);
 * the hours are conventions of the same pilots' day, movable per call.
 */
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

/**
 * The board's shared clock: one local day resolved to UTC instants
 * through Intl (never offset arithmetic), so every row's marks compare
 * by position. Geometry consumers read fractions via `xForBoardTime`.
 */
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

/**
 * A finding's run of hours placed on the axis. Bars and words diverge
 * deliberately: `endMs`/`x1` widen the last cited hour by the finding's
 * own step so a bar covers the hour it cites, while `endCitedMs`/
 * `x1Cited` stop at the finding's own last hour — the honest end for any
 * words. A span drawn to `endMs` but described to `end.local` is correct;
 * one described to `endMs` contradicts every other statement of the same
 * finding.
 */
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

/**
 * One windExceedance finding: window hours at or above a caller-supplied
 * ceiling. The threshold is the caller's own number echoed back — the
 * package owns no "safe wind" figure, and a member with no exceedance
 * entry made no statement (either under the ceiling or no ceiling was
 * supplied), never a verified calm.
 */
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

/**
 * The launch cell: surface wind at the window's open, peak-lift hour,
 * and close — the windDirection finding's own endpoint samples, m/s
 * (display conversion is the consumer's). Deterministic members only;
 * ensembles publish no circular direction statistics.
 */
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

/**
 * The strongest gust the day states, m/s, with its reporting class
 * carried per cell: an hour-max gust and an instantaneous sample are
 * different objects for the same air, so a consumer must label the
 * classes differently and never compare them. Null semantics means the
 * document declares none.
 */
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

/**
 * The top cell: the day's peak usable-lift top among its own windows.
 * `cloudCapped` states the cause at the cited peak hour from the
 * liftCeiling finding (the number IS cloud base when true); null when
 * the day has no liftCeiling statement. The cause-hour totals ride
 * beside the flag so a consumer can weigh the whole day.
 */
export interface CompareBoardTop {
  liftTopM: number;
  /** Null when the analysis ran without a launch. */
  aboveLaunchM: number | null;
  at: BoardInstant;
  cloudCapped: boolean | null;
  cloudCappedHours: number;
  ceilingHours: number;
}

/**
 * The storms cell, as data — consumers own the words. Two mutually
 * exclusive sources by the vocabulary's construction: capTiming where
 * the model publishes CIN, convectiveDay where it publishes CAPE alone;
 * ensembles neither (their row states nothing). "capUnjudgeable" is
 * convectiveDay's one statement: CAPE with no break time, because
 * absence of CIN must never read as "no cap". A convectiveDay whose
 * peak CAPE sits under the analysis's own instability floor states
 * "noInstability", the same floor capTiming's verdict uses. CAPE
 * magnitudes are model-specific — never compare them across rows.
 */
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

/**
 * The member's standing on this day. "window" and "quiet" are votes;
 * the other two are stated non-votes: an abstention is a data boundary
 * (the run covers a sliver of the day, or none of it), and a benched
 * member's published lift never reaches the launch, so every
 * launch-relative statement it makes is structurally biased. A blank
 * lane always has one of these reasons beside it.
 */
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

/**
 * One member's day as marks on the shared axis plus its cell facts —
 * instants and numbers, not sentences. Null means the member's data
 * states nothing for the cell (an ensemble's launch cell, a CIN-less
 * model's cap timing); a consumer prints a dash, never silence dressed
 * as calm. All wind values are m/s on the wire; display conversion is
 * the consumer's.
 */
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
