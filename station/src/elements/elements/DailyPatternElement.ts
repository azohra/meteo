import { DAILY_PATTERN_DEFAULT_SLOT_MINUTES, resolveStation } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  DAILY_PATTERN_CLASS,
  dailyPatternGate,
  dailyPatternScene,
  dailyPatternSource,
  measuredChartWidth,
} from "../../scene/index.js";
import type { DailyPatternScene } from "../../scene/index.js";
import type {
  FavorableDirection,
  HistoryPoint,
  SpeedThresholds,
  SpeedUnit,
  StationStrings,
} from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

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
    const { caption, svg } = dailyPatternSceneDom(scene);
    wrap.replaceChildren(caption, svg);
  }
}

/** One scene, one drawing — shared by the history-fed pattern above and the
 * climatology-fed twin. */
export function dailyPatternSceneDom(scene: DailyPatternScene): {
  caption: HTMLElement;
  svg: SVGElement;
} {
  const caption = h("output", { class: scene.caption.className }, scene.caption.text);

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
    scene.vanes.flatMap((vane) =>
      vane.label == null
        ? []
        : [
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
          ],
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
    scene.vanes.flatMap((vane) =>
      vane.value == null
        ? []
        : [
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
          ],
    ),
    scene.ticks.map((tick) =>
      hs(
        "text",
        { class: tick.className, "text-anchor": tick.anchor, x: tick.x, y: tick.y },
        tick.text,
      ),
    ),
  );

  return { caption, svg };
}
