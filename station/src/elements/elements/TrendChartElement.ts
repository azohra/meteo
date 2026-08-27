import { requireResolved } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  TREND_CLASS,
  measuredChartWidth,
  readoutAriaLive,
  trendGate,
  trendScene,
} from "../../scene/index.js";
import type { FormatTime, History, StationStrings } from "../../index.js";
import type { TrendSeries } from "../../geometry.js";
import type { TrendScene } from "../../scene/index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { renderChildren, renderScene } from "../lib/render.js";
import { PinnedCursor } from "../lib/pinned-cursor.js";

export class TrendChartElement extends MeteoStationElement {
  static readonly observedAttributes = ["series", "station-id"];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  #scene: TrendScene | null = null;
  #readout: HTMLElement | null = null;
  #wrap: HTMLElement | null = null;
  readonly #cursor = new PinnedCursor({
    scene: () => this.#scene,
    svg: () => this.#wrap?.querySelector("svg") ?? null,
    onChange: () => this.#updateCursor(),
  });

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-trend-chart");
    const series = requireResolved(
      "meteo-trend-chart",
      "series",
      this.getAttribute("series") === "temperature" || this.getAttribute("series") === "pressure"
        ? (this.getAttribute("series") as TrendSeries)
        : null,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, words } = this.display();

    const gate = trendGate(station, series, words);
    if (gate.kind !== "draw") {
      this.#observer?.disconnect();
      this.#observer = null;
      if (gate.kind === "hidden") {
        this.replaceChildren();
      } else {
        this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      }
      return;
    }

    const wrap = h("div", { class: TREND_CLASS });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildTrend(wrap, gate.history, series, words, formatTime, this.#width, station.name);
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

  #buildTrend(
    wrap: HTMLElement,
    history: History,
    series: TrendSeries,
    words: StationStrings,
    formatTime: FormatTime,
    width: number,
    stationName: string,
  ): void {
    const scene = trendScene({ formatTime, history, series, stationName, width, words });
    this.#scene = scene;

    const readout = h("output", {
      "aria-label": scene.readout.ariaLabel,
      class: scene.readout.className,
    });
    this.#readout = readout;
    this.#wrap = wrap;

    wrap.replaceChildren(readout, this.#drawSvg());
    this.#updateCursor();
  }

  #drawSvg(): Element {
    const scene = this.#scene;
    if (scene == null) throw new Error("meteo-trend-chart: no scene to draw");
    return renderScene(
      scene.draw([], {
        onClick: (event: Event) => this.#cursor.handleClick(event as MouseEvent),
        onPointerLeave: () => this.#cursor.handlePointerLeave(),
        onPointerMove: (event: Event) => this.#cursor.handlePointerMove(event as PointerEvent),
      }),
    );
  }

  #updateCursor(): void {
    const scene = this.#scene;
    const readout = this.#readout;
    const wrap = this.#wrap;
    if (scene == null || readout == null || wrap == null) return;
    const inspection = scene.inspect(this.#cursor.activeIndex());

    readout.setAttribute("aria-live", readoutAriaLive(this.#cursor.previewIndex));
    readout.replaceChildren(
      h("strong", null, inspection.readout.strong),
      h("span", null, inspection.readout.span),
    );
    /* The cursor splices in above the hit area, which must keep its
       identity across a gesture — replacing it would drop the pointer. */
    const svg = wrap.querySelector("svg");
    const hit = svg?.querySelector(".meteo-hit") ?? null;
    if (svg == null) return;
    for (const mark of [...svg.querySelectorAll(".meteo-cursor, .meteo-cursor-dot")]) mark.remove();
    for (const node of renderChildren(inspection.cursor)) svg.insertBefore(node as Node, hit);
  }
}
