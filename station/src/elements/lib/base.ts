import {
  freshness,
  requireResolved,
  resolveDisplay,
  resolveStation,
  stationFreshnessThresholds,
} from "../../index.js";
import type {
  FormatTime,
  FreshnessStatus,
  ResolvedDisplay,
  SpeedThresholds,
  Station,
  StationStringOverrides,
} from "../../index.js";
import { ELEMENTS_AMBIENT_HINT, STATION_FEED_CONTEXT_KEY } from "./ambient.js";
import type { AmbientStationFeed } from "./ambient.js";
import { numberAttribute, parseThresholdsAttribute, unitAttribute } from "./attributes.js";
import { requestContext } from "./context.js";
import type { ContextProvision } from "./context.js";
import { subscribeTicker } from "../../client/index.js";

export abstract class MeteoElement extends HTMLElement {
  #cleanups: Array<() => void> = [];
  #ambient: ContextProvision<AmbientStationFeed> | null = null;
  #wired = false;

  connectedCallback(): void {
    /* A queued connectedCallback can fire on an element already detached
     * again (moved mid-render); the real insertion queues a fresh one. */
    if (!this.isConnected) return;
    this.style.display = "contents";
    this.#ambient = requestContext<AmbientStationFeed>(this, STATION_FEED_CONTEXT_KEY);
    if (this.#ambient != null) {
      this.addCleanup(this.#ambient.subscribe(() => this.requestRender()));
    }
    this.#wired = true;
    this.connected();
    this.requestRender();
  }

  disconnectedCallback(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#ambient = null;
    this.#wired = false;
    this.disconnected();
  }

  attributeChangedCallback(
    _name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    this.requestRender();
  }

  requestRender(): void {
    if (!this.isConnected || !this.#wired) return;
    this.render();
  }

  protected ambient(): AmbientStationFeed | null {
    return this.#ambient?.getValue() ?? null;
  }

  protected addCleanup(cleanup: () => void): void {
    this.#cleanups.push(cleanup);
  }

  protected upgradeProperty(name: string): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as Record<string, unknown>)[name];
      delete (this as Record<string, unknown>)[name];
      (this as Record<string, unknown>)[name] = value;
    }
  }

  protected resolveRequiredStation(component: string, stationProp: Station | undefined): Station {
    return requireResolved(
      component,
      "station",
      stationProp ??
        resolveStation(this.ambient()?.feed ?? null, this.getAttribute("station-id") ?? undefined),
      ELEMENTS_AMBIENT_HINT,
    );
  }

  protected connected(): void {}
  protected disconnected(): void {}
  protected abstract render(): void;
}

export abstract class MeteoStationElement extends MeteoElement {
  #station: Station | undefined;
  #strings: StationStringOverrides | undefined;
  #formatTime: FormatTime | undefined;
  #thresholds: SpeedThresholds | null | undefined = undefined;
  #thresholdsSet = false;
  #servedAt: string | null | undefined = undefined;
  #receivedAtMs: number | null | undefined = undefined;

  constructor() {
    super();
    for (const name of [
      "station",
      "strings",
      "formatTime",
      "thresholds",
      "servedAt",
      "receivedAtMs",
    ]) {
      this.upgradeProperty(name);
    }
  }

  get station(): Station | undefined {
    return this.#station;
  }
  set station(value: Station | undefined) {
    this.#station = value;
    this.requestRender();
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

  get thresholds(): SpeedThresholds | null | undefined {
    return this.#thresholds;
  }
  set thresholds(value: SpeedThresholds | null | undefined) {
    this.#thresholds = value;
    this.#thresholdsSet = value !== undefined;
    this.requestRender();
  }

  protected display(): ResolvedDisplay {
    return resolveDisplay(this.ambient(), {
      strings: this.#strings,
      unit: unitAttribute(this.getAttribute("unit")),
      formatTime: this.#formatTime,
      thresholds: this.#thresholdsSet
        ? this.#thresholds
        : parseThresholdsAttribute(this.getAttribute("thresholds")),
    });
  }

  protected requiredStation(component: string): Station {
    return this.resolveRequiredStation(component, this.#station);
  }

  get servedAt(): string | null | undefined {
    return this.#servedAt;
  }
  set servedAt(value: string | null | undefined) {
    this.#servedAt = value;
    this.requestRender();
  }

  get receivedAtMs(): number | null | undefined {
    return this.#receivedAtMs;
  }
  set receivedAtMs(value: number | null | undefined) {
    this.#receivedAtMs = value;
    this.requestRender();
  }

  protected servedAtValue(): string | null {
    if (this.#servedAt !== undefined) return this.#servedAt;
    return this.getAttribute("served-at") ?? this.ambient()?.feed?.servedAt ?? null;
  }

  protected receivedAtMsValue(): number | null {
    if (this.#receivedAtMs !== undefined) return this.#receivedAtMs;
    const attr = numberAttribute(this.getAttribute("received-at-ms"));
    return attr !== undefined ? attr : (this.ambient()?.receivedAtMs ?? null);
  }

  protected watchFreshness(): void {
    this.addCleanup(subscribeTicker(() => this.requestRender()));
  }

  protected freshnessOf(station: Station): FreshnessStatus | null {
    const observedAt = station.reading?.observedAt ?? null;
    const servedAt = this.servedAtValue();
    const receivedAtMs = this.receivedAtMsValue();
    if (observedAt == null || servedAt == null || receivedAtMs == null) return null;
    return freshness(
      { observedAt, servedAt, receivedAtMs, nowMs: Date.now() },
      stationFreshnessThresholds(station),
    );
  }
}
