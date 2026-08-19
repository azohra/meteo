import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  WIND_CHART_CLASS,
  activeChartIndex,
  chartIndexAtClient,
  measuredChartWidth,
  readoutAriaLive,
  togglePinnedAt,
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
import { h, hs } from "../lib/h.js";
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
    "plot-height",
    "station-id",
    "thresholds",
    "unit",
    "window-hours",
  ];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  #pinnedAt: string | null = null;
  #previewIndex: number | null = null;
  #scene: WindChartScene | null = null;
  #readout: HTMLElement | null = null;
  #svg: SVGElement | null = null;
  #hit: SVGElement | null = null;

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
  ): void {
    const scene = windChartScene({
      compareOffsetDays: numberAttribute(this.getAttribute("compare-offset-days")),
      favorableDirections,
      formatTime,
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
      hs(
        "defs",
        null,
        hs(
          "pattern",
          {
            height: scene.defs.pattern.height,
            id: scene.defs.pattern.id,
            patternTransform: scene.defs.pattern.transform,
            patternUnits: scene.defs.pattern.units,
            width: scene.defs.pattern.width,
          },
          hs("line", {
            class: scene.defs.pattern.line.className,
            x1: scene.defs.pattern.line.x1,
            x2: scene.defs.pattern.line.x2,
            y1: scene.defs.pattern.line.y1,
            y2: scene.defs.pattern.line.y2,
          }),
        ),
        hs(
          "clipPath",
          { id: scene.defs.clip.id },
          hs("rect", {
            height: scene.defs.clip.rect.height,
            width: scene.defs.clip.rect.width,
            x: scene.defs.clip.rect.x,
            y: scene.defs.clip.rect.y,
          }),
        ),
      ),
      scene.zones.map((zone) =>
        hs("rect", {
          class: zone.className,
          height: zone.height,
          width: zone.width,
          x: zone.x,
          y: zone.y,
        }),
      ),
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
      scene.thresholdGuides.map(({ line, label }) =>
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
      scene.vaneGuides.map((guide) =>
        hs("line", {
          class: guide.className,
          x1: guide.x1,
          x2: guide.x2,
          y1: guide.y1,
          y2: guide.y2,
        }),
      ),
      scene.gaps.map((gap) =>
        hs("rect", {
          class: gap.className,
          fill: gap.fill,
          height: gap.height,
          width: gap.width,
          x: gap.x,
          y: gap.y,
        }),
      ),
      scene.band != null &&
        hs("polygon", { class: scene.band.className, points: scene.band.points }),
      scene.compare != null &&
        hs("polyline", {
          class: scene.compare.className,
          "clip-path": scene.compare.clipPath,
          points: scene.compare.points,
        }),
      scene.mean.kind === "polyline"
        ? hs("polyline", { class: scene.mean.className, points: scene.mean.points })
        : scene.mean.segments.map((segment) =>
            hs("line", {
              class: segment.className,
              x1: segment.x1,
              x2: segment.x2,
              y1: segment.y1,
              y2: segment.y2,
            }),
          ),
      scene.calmNote != null &&
        hs(
          "text",
          {
            class: scene.calmNote.className,
            "text-anchor": scene.calmNote.anchor,
            x: scene.calmNote.x,
            y: scene.calmNote.y,
          },
          scene.calmNote.text,
        ),
      hs(
        "text",
        {
          class: scene.rowLabels.to.className,
          "text-anchor": scene.rowLabels.to.anchor,
          x: scene.rowLabels.to.x,
          y: scene.rowLabels.to.y,
        },
        scene.rowLabels.to.text,
      ),
      scene.vanes.map((vane) =>
        vane.mark.kind === "calm"
          ? hs(
              "text",
              {
                class: vane.mark.text.className,
                "text-anchor": vane.mark.text.anchor,
                x: vane.mark.text.x,
                y: vane.mark.text.y,
              },
              vane.mark.text.text,
            )
          : hs("path", { class: vane.mark.className, d: vane.mark.d }),
      ),
      scene.vanes.map((vane) =>
        hs(
          "text",
          {
            class: vane.label.className,
            "text-anchor": vane.label.anchor,
            x: vane.label.x,
            y: vane.label.y,
          },
          vane.label.text,
        ),
      ),
      hs(
        "text",
        {
          class: scene.rowLabels.avg.className,
          "text-anchor": scene.rowLabels.avg.anchor,
          x: scene.rowLabels.avg.x,
          y: scene.rowLabels.avg.y,
        },
        scene.rowLabels.avg.text,
      ),
      scene.vanes.map((vane) =>
        hs(
          "text",
          {
            class: vane.value.className,
            "text-anchor": vane.value.anchor,
            x: vane.value.x,
            y: vane.value.y,
          },
          vane.value.text,
        ),
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
      readoutSpan(inspection.readout.span),
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
