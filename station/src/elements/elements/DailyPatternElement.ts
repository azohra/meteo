import { DAILY_PATTERN_DEFAULT_SLOT_MINUTES, resolveStation } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  DAILY_PATTERN_CLASS,
  dailyPatternGate,
  dailyPatternScene,
  dailyPatternSource,
  measuredChartWidth,
} from "../../scene/index.js";
import type {
  FavorableDirection,
  HistoryPoint,
  SpeedThresholds,
  SpeedUnit,
  StationStrings,
} from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { renderChildren } from "../lib/render.js";

let hatchCounter = 0;

export class DailyPatternElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "favorable-directions",
    "plot-height",
    "slot-minutes",
    "station-id",
    "thresholds",
    "unit",
    "utc-offset-minutes",
  ];

  #points: HistoryPoint[] | undefined;
  #width: number | null = null;
  #observer: ResizeObserver | null = null;

  constructor() {
    super();
    this.upgradeProperty("points");
  }

  get points(): HistoryPoint[] | undefined {
    return this.#points;
  }
  set points(value: HistoryPoint[] | undefined) {
    this.#points = value;
    this.requestRender();
  }

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#points == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { favorableDirections, thresholds, unit, words } = this.display();
    const { source, periodMinutes } = dailyPatternSource(this.#points, station);

    const gate = dailyPatternGate(source, words);
    if (gate.kind === "note") {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }

    const wrap = h("div", { class: DAILY_PATTERN_CLASS });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildChart(
      wrap,
      source,
      periodMinutes,
      thresholds,
      favorableDirections,
      unit,
      words,
      this.#width,
      station?.name,
    );
  }

  #observe(wrap: HTMLElement): void {
    this.#observer?.disconnect();
    if (typeof ResizeObserver === "undefined") {
      this.#width = CHART_FALLBACK_WIDTH;
      this.#observer = null;
      return;
    }
    this.#observer = new ResizeObserver((entries) => {
      const width = measuredChartWidth(entries[0]?.contentRect.width ?? 0);
      if (width !== this.#width) {
        this.#width = width;
        this.requestRender();
      }
    });
    this.#observer.observe(wrap);
  }

  #buildChart(
    wrap: HTMLElement,
    points: HistoryPoint[],
    periodMinutes: number | null,
    thresholds: SpeedThresholds | undefined,
    favorableDirections: FavorableDirection[] | undefined,
    unit: SpeedUnit,
    words: StationStrings,
    width: number,
    stationName: string | undefined,
  ): void {
    const scene = dailyPatternScene({
      favorableDirections,
      hatchId: `meteo-daily-pattern-hatch-e${++hatchCounter}`,
      periodMinutes,
      plotHeight: numberAttribute(this.getAttribute("plot-height")),
      points,
      slotMinutes:
        numberAttribute(this.getAttribute("slot-minutes")) ?? DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
      stationName,
      thresholds,
      unit,
      utcOffsetMinutes: numberAttribute(this.getAttribute("utc-offset-minutes")) ?? 0,
      width,
      words,
    });
    wrap.replaceChildren(...renderChildren(scene));
  }
}
