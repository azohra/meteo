import { requireResolved } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  TREND_CLASS,
  activeChartIndex,
  chartIndexAtClient,
  measuredChartWidth,
  readoutAriaLive,
  togglePinnedAt,
  trendGate,
  trendScene,
} from "../../scene/index.js";
import type { FormatTime, History, StationStrings } from "../../index.js";
import type { TrendSeries } from "../../geometry.js";
import type { TrendScene } from "../../scene/index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

export class TrendChartElement extends MeteoStationElement {
  static readonly observedAttributes = ["series", "station-id"];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  #pinnedAt: string | null = null;
  #previewIndex: number | null = null;
  #scene: TrendScene | null = null;
  #readout: HTMLElement | null = null;
  #svg: SVGElement | null = null;
  #hit: SVGElement | null = null;

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

    const hit = hs("rect", {
      class: scene.hit.className,
      fill: scene.hit.fill,
      height: scene.hit.height,
      onclick: (event: Event) => this.#handleClick(event as MouseEvent),
      onpointerleave: () => {
        this.#previewIndex = null;
        this.#updateCursor();
      },
      onpointermove: (event: Event) => this.#handlePointerMove(event as PointerEvent),
      width: scene.hit.width,
      x: scene.hit.x,
      y: scene.hit.y,
    });
    this.#hit = hit;

    const svg = hs(
      "svg",
      {
        "aria-label": scene.svg.ariaLabel,
        class: scene.svg.className,
        height: scene.svg.height,
        role: "img",
        viewBox: scene.svg.viewBox,
        width: scene.svg.width,
      },
      scene.grid.map(({ line, label }) =>
        hs(
          "g",
          null,
          hs("line", { class: line.className, x1: line.x1, x2: line.x2, y1: line.y1, y2: line.y2 }),
          hs(
            "text",
            { class: label.className, "text-anchor": label.anchor, x: label.x, y: label.y },
            label.text,
          ),
        ),
      ),
      scene.segments.map((segment) =>
        segment.kind === "dot"
          ? hs("circle", {
              class: segment.className,
              cx: segment.cx,
              cy: segment.cy,
              r: segment.r,
            })
          : hs("polyline", { class: segment.className, points: segment.points }),
      ),
      scene.ticks.map((tick) =>
        hs(
          "text",
          { class: tick.className, "text-anchor": tick.anchor, x: tick.x, y: tick.y },
          tick.text,
        ),
      ),
      hit,
    );
    this.#svg = svg;

    wrap.replaceChildren(readout, svg);
    this.#updateCursor();
  }

  #indexAtPoint(clientX: number): number | null {
    const scene = this.#scene;
    const svg = this.#svg;
    if (scene == null || svg == null) return null;
    return chartIndexAtClient(
      scene.points,
      scene.frame,
      scene.scales,
      clientX,
      svg.getBoundingClientRect(),
    );
  }

  #handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    this.#previewIndex = this.#indexAtPoint(event.clientX);
    this.#updateCursor();
  }

  #handleClick(event: MouseEvent): void {
    const index = this.#indexAtPoint(event.clientX);
    if (index == null) return;
    const observedAt = this.#scene?.points[index]?.observedAt;
    if (observedAt == null) return;
    this.#pinnedAt = togglePinnedAt(this.#pinnedAt, observedAt);
    this.#previewIndex = null;
    this.#updateCursor();
  }

  #updateCursor(): void {
    const scene = this.#scene;
    const readout = this.#readout;
    const svg = this.#svg;
    const hit = this.#hit;
    if (scene == null || readout == null || svg == null || hit == null) return;
    const inspection = scene.inspect(
      activeChartIndex(scene.points, this.#pinnedAt, this.#previewIndex),
    );

    readout.setAttribute("aria-live", readoutAriaLive(this.#previewIndex));
    readout.replaceChildren(
      h("strong", null, inspection.readout.strong),
      h("span", null, inspection.readout.span),
    );

    for (const mark of [...svg.querySelectorAll(".meteo-cursor, .meteo-cursor-dot")]) mark.remove();
    const cursor = inspection.cursor;
    if (cursor != null) {
      svg.insertBefore(
        hs("line", {
          class: cursor.line.className,
          x1: cursor.line.x1,
          x2: cursor.line.x2,
          y1: cursor.line.y1,
          y2: cursor.line.y2,
        }),
        hit,
      );
      if (cursor.dot != null) {
        svg.insertBefore(
          hs("circle", {
            class: cursor.dot.className,
            cx: cursor.dot.cx,
            cy: cursor.dot.cy,
            r: cursor.dot.r,
          }),
          hit,
        );
      }
    }
  }
}
