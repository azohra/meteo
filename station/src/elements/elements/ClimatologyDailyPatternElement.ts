import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  CLIMATOLOGY_PATTERN_CLASS,
  hasClimatology,
  climatologyPatternScene,
  measuredChartWidth,
} from "../../scene/index.js";
import type { StationClimatology } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { renderChildren } from "../lib/render.js";
import { numberAttribute, parseMonthsAttribute } from "../lib/attributes.js";

let hatchCounter = 0;

export class ClimatologyDailyPatternElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "favorable-directions",
    "months",
    "plot-height",
    "station-name",
    "thresholds",
    "unit",
  ];

  #document: StationClimatology | null | undefined;
  #width: number | null = null;
  #observer: ResizeObserver | null = null;

  constructor() {
    super();
    for (const name of ["document"]) this.upgradeProperty(name);
  }

  get document(): StationClimatology | null | undefined {
    return this.#document;
  }
  set document(value: StationClimatology | null | undefined) {
    this.#document = value;
    this.requestRender();
  }

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const { favorableDirections, thresholds, unit, words } = this.display();
    if (!hasClimatology(this.#document)) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(
        ...renderChildren(
          climatologyPatternScene({
            document: this.#document,
            hatchId: "",
            plotHeight: undefined,
            stationName: undefined,
            thresholds: undefined,
            unit,
            width: 0,
            words,
          }),
        ),
      );
      return;
    }

    const wrap = h("div", { class: CLIMATOLOGY_PATTERN_CLASS });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    const scene = climatologyPatternScene({
      document: this.#document,
      favorableDirections,
      filters: { months: parseMonthsAttribute(this.getAttribute("months")) },
      hatchId: `meteo-climatology-hatch-e${++hatchCounter}`,
      plotHeight: numberAttribute(this.getAttribute("plot-height")),
      stationName: this.getAttribute("station-name") ?? undefined,
      thresholds,
      unit,
      width: this.#width,
      words,
    });
    wrap.replaceChildren(...renderChildren(scene));
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
}
