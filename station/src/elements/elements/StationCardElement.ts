import {
  freshness,
  mergeStringOverrides,
  resolveDisplay,
  resolveStrings,
  stationFreshnessThresholds,
} from "../../index.js";
import {
  STATION_CARD_CLASS,
  cardHeaderNode,
  cardPartThresholds,
  cardPartWiringError,
  summaryNode,
} from "../../scene/index.js";
import type {
  FormatTime,
  FreshnessStatus,
  SpeedThresholds,
  SpeedUnit,
  Station,
  StationStringOverrides,
} from "../../index.js";
import { MeteoElement, MeteoStationElement } from "../lib/base.js";
import { provideContext, requestContext } from "../lib/context.js";
import type { ContextProvision } from "../lib/context.js";
import { h } from "../lib/h.js";
import { renderOptional, renderScene } from "../lib/render.js";
import { numberAttribute } from "../lib/attributes.js";
import { subscribeTicker } from "../../client/index.js";
import { CurrentConditionsElement } from "./CurrentConditionsElement.js";
import { WindHistoryChartElement } from "./WindHistoryChartElement.js";

const STATION_CARD_CONTEXT_KEY = "meteo-station-card";

type StationCardContextValue = {
  station: Station;
  servedAt: string | null;
  receivedAtMs: number | null;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  strings: StationStringOverrides | undefined;
  formatTime: FormatTime;
};

export class StationCardElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "compose",
    "received-at-ms",
    "served-at",
    "station-id",
    "thresholds",
    "unit",
  ];

  #listeners = new Set<() => void>();
  #article: HTMLElement | null = null;

  protected override connected(): void {
    this.addCleanup(
      provideContext<StationCardContextValue>(this, STATION_CARD_CONTEXT_KEY, {
        getValue: () => this.#value(),
        subscribe: (listener) => {
          this.#listeners.add(listener);
          return () => this.#listeners.delete(listener);
        },
      }),
    );
  }

  #value(): StationCardContextValue {
    const station = this.requiredStation("meteo-station-card");
    const { formatTime, strings, thresholds, unit } = resolveDisplay(this.ambient(), {
      strings: this.strings,
      thresholds: this.thresholds !== undefined ? this.thresholds : this.#thresholdsAttribute(),
      unit: this.#unitAttribute(),
      formatTime: this.formatTime,
    });
    return {
      station,
      servedAt: this.servedAtValue(),
      receivedAtMs: this.receivedAtMsValue(),
      thresholds,
      unit,
      strings,
      formatTime,
    };
  }

  #unitAttribute(): SpeedUnit | undefined {
    const value = this.getAttribute("unit");
    return value === "kmh" || value === "knots" || value === "mph" || value === "mps"
      ? value
      : undefined;
  }

  #thresholdsAttribute(): SpeedThresholds | null | undefined {
    const raw = this.getAttribute("thresholds");
    if (raw == null) return undefined;
    if (raw.trim() === "none") return null;
    try {
      return JSON.parse(raw) as SpeedThresholds;
    } catch {
      return undefined;
    }
  }

  protected override render(): void {
    const value = this.#value();
    if (this.#article == null) {
      const authoredText = [...this.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      const composing = this.hasAttribute("compose") || this.children.length > 0 || authoredText;
      const article = h("article", {
        class: STATION_CARD_CLASS,
        "data-status": value.station.status,
      });
      if (composing) {
        article.append(...this.childNodes);
      } else {
        article.append(
          document.createElement("meteo-station-card-header"),
          document.createElement("meteo-station-card-instrument"),
          document.createElement("meteo-station-card-chart"),
          document.createElement("meteo-station-card-summary"),
        );
      }
      this.#article = article;
      this.replaceChildren(article);
    } else {
      this.#article.setAttribute("data-status", value.station.status);
    }
    for (const listener of [...this.#listeners]) listener();
  }
}

abstract class StationCardPartElement extends MeteoElement {
  #context: ContextProvision<StationCardContextValue> | null = null;
  #strings: StationStringOverrides | undefined;
  #formatTime: FormatTime | undefined;
  protected abstract readonly partName: string;

  constructor() {
    super();
    for (const name of ["strings", "formatTime"]) this.upgradeProperty(name);
  }

  get strings(): StationStringOverrides | undefined {
    return this.#strings;
  }
  set strings(value: StationStringOverrides | undefined) {
    this.#strings = value;
    this.requestRender();
  }

  get formatTime(): FormatTime | undefined {
    return this.#formatTime;
  }
  set formatTime(value: FormatTime | undefined) {
    this.#formatTime = value;
    this.requestRender();
  }

  protected override connected(): void {
    this.#context = requestContext<StationCardContextValue>(this, STATION_CARD_CONTEXT_KEY);
    if (this.#context == null) {
      throw new Error(
        cardPartWiringError(`<meteo-station-card-${this.partName}>`, "<meteo-station-card>"),
      );
    }
    this.addCleanup(this.#context.subscribe(() => this.requestRender()));
    this.addCleanup(() => {
      this.#context = null;
    });
  }

  protected card(): StationCardContextValue {
    const context = this.#context;
    if (context == null) {
      throw new Error(
        `<meteo-station-card-${this.partName}> must render inside <meteo-station-card> — ` +
          "the provider carries the station, clocks, and display settings.",
      );
    }
    const value = context.getValue();
    return {
      ...value,
      strings: mergeStringOverrides(value.strings, this.#strings),
      formatTime: this.#formatTime ?? value.formatTime,
    };
  }
}

export class StationCardHeaderElement extends StationCardPartElement {
  protected override readonly partName = "header";

  protected override connected(): void {
    super.connected();
    this.addCleanup(subscribeTicker(() => this.requestRender()));
  }

  protected override render(): void {
    const { station, servedAt, receivedAtMs, strings } = this.card();
    const words = resolveStrings(strings);
    const observedAt = station.reading?.observedAt ?? null;
    const status: FreshnessStatus | null =
      observedAt == null || servedAt == null || receivedAtMs == null
        ? null
        : freshness(
            { observedAt, servedAt, receivedAtMs, nowMs: Date.now() },
            stationFreshnessThresholds(station),
          );

    this.replaceChildren(renderScene(cardHeaderNode(station, status, words)));
  }
}

export class StationCardInstrumentElement extends StationCardPartElement {
  static readonly observedAttributes = ["thresholds", "unit"];
  protected override readonly partName = "instrument";

  protected override render(): void {
    const context = this.card();
    const child = document.createElement("meteo-current-conditions") as CurrentConditionsElement;
    child.station = context.station;
    child.strings = context.strings;
    child.thresholds = cardPartThresholds(partThresholds(this), context.thresholds);
    child.formatTime = context.formatTime;
    child.servedAt = context.servedAt;
    child.receivedAtMs = context.receivedAtMs;
    child.setAttribute("unit", this.getAttribute("unit") ?? context.unit);
    this.replaceChildren(child);
  }
}

function partThresholds(part: HTMLElement): SpeedThresholds | null | undefined {
  const raw = part.getAttribute("thresholds");
  if (raw == null) return undefined;
  if (raw.trim() === "none") return null;
  try {
    return JSON.parse(raw) as SpeedThresholds;
  } catch {
    return undefined;
  }
}

export class StationCardChartElement extends StationCardPartElement {
  static readonly observedAttributes = ["plot-height", "thresholds", "unit"];
  protected override readonly partName = "chart";

  protected override render(): void {
    const context = this.card();
    const child = document.createElement("meteo-wind-history-chart") as WindHistoryChartElement;
    child.station = context.station;
    child.strings = context.strings;
    child.thresholds = cardPartThresholds(partThresholds(this), context.thresholds);
    child.formatTime = context.formatTime;
    child.setAttribute("unit", this.getAttribute("unit") ?? context.unit);
    const plotHeight = numberAttribute(this.getAttribute("plot-height"));
    if (plotHeight != null) child.setAttribute("plot-height", String(plotHeight));
    this.replaceChildren(child);
  }
}

export class StationCardSummaryElement extends StationCardPartElement {
  protected override readonly partName = "summary";

  protected override render(): void {
    const context = this.card();
    const words = resolveStrings(context.strings);
    this.replaceChildren(
      ...renderOptional(summaryNode(context.station, context.unit, words, context.formatTime)),
    );
  }
}
