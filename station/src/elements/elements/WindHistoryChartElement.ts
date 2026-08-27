import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  WIND_CHART_CLASS,
  measuredChartWidth,
  readoutAriaLive,
  windChartGate,
  windChartScene,
} from "../../scene/index.js";
import type {
  FavorableDirection,
  FormatTime,
  History,
  SpeedThresholds,
  SpeedUnit,
  StationStrings,
} from "../../index.js";
import type { ReadoutPart, WindChartScene } from "../../scene/index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { windArrowSvg } from "../lib/fragments.js";
import { PinnedCursor } from "../lib/pinned-cursor.js";
import { h } from "../lib/h.js";
import { renderChildren, renderScene } from "../lib/render.js";
import type { ElementChild } from "../lib/h.js";

let hatchCounter = 0;

function readoutSpan(parts: ReadoutPart[]): HTMLElement {
  const children: ElementChild[] = parts.map((part) =>
    part.kind === "arrow" ? windArrowSvg(part.deg) : part.text,
  );
  return h("span", null, ...children);
}

export class WindHistoryChartElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "compare-offset-days",
    "favorable-directions",
    "night-shading",
    "plot-height",
    "station-id",
    "thresholds",
    "unit",
    "window-hours",
  ];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  #scene: WindChartScene | null = null;
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
    const station = this.requiredStation("meteo-wind-history-chart");
    const { favorableDirections, formatTime, thresholds, unit, words } = this.display();

    const gate = windChartGate(station, words);
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

    const wrap = h("div", { class: WIND_CHART_CLASS });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildChart(
      wrap,
      gate.history,
      thresholds,
      favorableDirections,
      unit,
      words,
      formatTime,
      this.#width,
      station.name,
      this.hasAttribute("night-shading")
        ? { latitude: station.latitude, longitude: station.longitude }
        : null,
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
    history: History,
    thresholds: SpeedThresholds | undefined,
    favorableDirections: FavorableDirection[] | undefined,
    unit: SpeedUnit,
    words: StationStrings,
    formatTime: FormatTime,
    width: number,
    stationName: string,
    night: { latitude: number | null; longitude: number | null } | null,
  ): void {
    const scene = windChartScene({
      compareOffsetDays: numberAttribute(this.getAttribute("compare-offset-days")),
      favorableDirections,
      formatTime,
      night,
      hatchId: `meteo-hatch-e${++hatchCounter}`,
      history,
      plotHeight: numberAttribute(this.getAttribute("plot-height")),
      stationName,
      thresholds,
      unit,
      width,
      windowHours: numberAttribute(this.getAttribute("window-hours")),
      words,
    });
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
    if (scene == null) throw new Error("meteo-wind-history-chart: no scene to draw");
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
      readoutSpan(inspection.readout.span),
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
