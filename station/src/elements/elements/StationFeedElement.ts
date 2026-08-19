import { createStationFeedStore, createStationStore } from "../../client/index.js";
import type { PollError, StationStore } from "../../client/index.js";
import { localeFormatTime } from "../../index.js";
import type {
  FavorableDirection,
  FormatTime,
  SpeedThresholds,
  StationFeed,
  StationStringOverrides,
} from "../../index.js";
import { STATION_FEED_CONTEXT_KEY } from "../lib/ambient.js";
import type { AmbientStationFeed } from "../lib/ambient.js";
import {
  numberAttribute,
  parseArcsAttribute,
  parseThresholdsAttribute,
  unitAttribute,
} from "../lib/attributes.js";
import { MeteoElement } from "../lib/base.js";
import { provideContext } from "../lib/context.js";

type FeedLikeStore = Pick<StationStore, "subscribe" | "start" | "stop" | "refresh"> & {
  feedSnapshot(): {
    feed: StationFeed | null;
    receivedAtMs: number | null;
    error: PollError | null;
  };
};

export class StationFeedElement extends MeteoElement {
  static readonly observedAttributes = [
    "current-poll-seconds",
    "locale",
    "paused",
    "poll-seconds",
    "favorable-directions",
    "src",
    "station",
    "thresholds",
    "unit",
  ];

  #feed: StationFeed | null = null;
  #receivedAtMs: number | null = null;
  #strings: StationStringOverrides | undefined;
  #formatTime: FormatTime | undefined;
  #thresholds: SpeedThresholds | undefined;
  #favorableDirections: FavorableDirection[] | undefined;
  #fetchInit: RequestInit | undefined;
  #store: FeedLikeStore | null = null;
  #storeKey: string | null = null;
  #unsubscribeStore: (() => void) | null = null;
  #lastFeed: StationFeed | null = null;
  #lastError: PollError | null = null;
  #listeners = new Set<() => void>();

  constructor() {
    super();
    for (const name of [
      "feed",
      "receivedAtMs",
      "strings",
      "formatTime",
      "thresholds",
      "favorableDirections",
      "fetchInit",
    ]) {
      this.upgradeProperty(name);
    }
  }

  #ambientValue(): AmbientStationFeed {
    const snapshot = this.#store?.feedSnapshot();
    const locale = this.getAttribute("locale");
    return {
      feed: snapshot != null ? snapshot.feed : this.#feed,
      receivedAtMs: snapshot != null ? snapshot.receivedAtMs : this.#receivedAtMs,
      strings: this.#strings,
      unit: unitAttribute(this.getAttribute("unit")),
      formatTime: this.#formatTime ?? (locale != null ? localeFormatTime(locale) : undefined),
      thresholds:
        this.#thresholds ?? parseThresholdsAttribute(this.getAttribute("thresholds")) ?? undefined,
      favorableDirections:
        this.#favorableDirections ??
        parseArcsAttribute(this.getAttribute("favorable-directions")) ??
        undefined,
    };
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  get feed(): StationFeed | null {
    return this.#ambientValue().feed;
  }
  set feed(value: StationFeed | null) {
    this.#feed = value;
    this.#notify();
  }

  get receivedAtMs(): number | null {
    return this.#ambientValue().receivedAtMs;
  }
  set receivedAtMs(value: number | null) {
    this.#receivedAtMs = value;
    this.#notify();
  }

  get strings(): StationStringOverrides | undefined {
    return this.#strings;
  }
  set strings(value: StationStringOverrides | undefined) {
    this.#strings = value;
    this.#notify();
  }

  get formatTime(): FormatTime | undefined {
    return this.#formatTime;
  }
  set formatTime(value: FormatTime | undefined) {
    this.#formatTime = value;
    this.#notify();
  }

  get thresholds(): SpeedThresholds | undefined {
    return this.#thresholds;
  }
  set thresholds(value: SpeedThresholds | undefined) {
    this.#thresholds = value;
    this.#notify();
  }

  get favorableDirections(): FavorableDirection[] | undefined {
    return this.#favorableDirections;
  }
  set favorableDirections(value: FavorableDirection[] | undefined) {
    this.#favorableDirections = value;
    this.#notify();
  }

  get fetchInit(): RequestInit | undefined {
    return this.#fetchInit;
  }
  set fetchInit(value: RequestInit | undefined) {
    this.#fetchInit = value;
  }

  get error(): PollError | null {
    return this.#store?.feedSnapshot().error ?? null;
  }

  refresh(): void {
    this.#store?.refresh();
  }

  protected override connected(): void {
    this.addCleanup(
      provideContext<AmbientStationFeed>(this, STATION_FEED_CONTEXT_KEY, {
        getValue: () => this.#ambientValue(),
        subscribe: (listener) => {
          this.#listeners.add(listener);
          return () => this.#listeners.delete(listener);
        },
      }),
    );
    this.#syncStore();
    this.addCleanup(() => this.#teardownStore());
  }

  override attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (["current-poll-seconds", "paused", "poll-seconds", "src", "station"].includes(name)) {
      this.#syncStore();
    }
    this.#notify();
  }

  protected override render(): void {
    this.#notify();
  }

  #teardownStore(): void {
    this.#unsubscribeStore?.();
    this.#unsubscribeStore = null;
    this.#store?.stop();
    this.#store = null;
    this.#storeKey = null;
  }

  #syncStore(): void {
    const src = this.getAttribute("src");
    const stationId = this.getAttribute("station");
    const pollSeconds = numberAttribute(this.getAttribute("poll-seconds"));
    const currentPollSeconds = numberAttribute(this.getAttribute("current-poll-seconds"));
    const key =
      src == null
        ? null
        : JSON.stringify([src, stationId, pollSeconds ?? null, currentPollSeconds ?? null]);

    if (key !== this.#storeKey) {
      this.#teardownStore();
      this.#storeKey = key;
      if (src != null) {
        this.#store = this.#buildStore(src, stationId, pollSeconds, currentPollSeconds);
        this.#unsubscribeStore = this.#store.subscribe(() => this.#onStoreChange());
      }
    }

    if (this.#store != null) {
      if (this.hasAttribute("paused")) this.#store.stop();
      else this.#store.start();
    }
  }

  #buildStore(
    src: string,
    stationId: string | null,
    pollSeconds: number | undefined,
    currentPollSeconds: number | undefined,
  ): FeedLikeStore {
    const fetchInit = () => this.#fetchInit;
    if (stationId != null) {
      const store = createStationStore(src, stationId, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        ...(currentPollSeconds != null ? { currentPollSeconds } : {}),
        fetchInit,
      });
      return {
        ...store,
        feedSnapshot: () => {
          const snapshot = store.getSnapshot();
          return {
            feed: snapshot.feed,
            receivedAtMs: snapshot.receivedAtMs,
            error: snapshot.error,
          };
        },
      };
    }
    const store = createStationFeedStore(src, {
      ...(pollSeconds != null ? { pollSeconds } : {}),
      fetchInit,
    });
    return {
      subscribe: store.subscribe,
      start: store.start,
      stop: store.stop,
      refresh: store.refresh,
      feedSnapshot: () => {
        const snapshot = store.getSnapshot();
        return { feed: snapshot.data, receivedAtMs: snapshot.receivedAtMs, error: snapshot.error };
      },
    };
  }

  #onStoreChange(): void {
    const snapshot = this.#store?.feedSnapshot();
    if (snapshot == null) return;
    if (snapshot.feed !== this.#lastFeed && snapshot.feed != null) {
      this.#lastFeed = snapshot.feed;
      this.dispatchEvent(
        new CustomEvent("meteo-feed", {
          detail: { feed: snapshot.feed, receivedAtMs: snapshot.receivedAtMs },
        }),
      );
    }
    if (snapshot.error !== this.#lastError && snapshot.error != null) {
      this.#lastError = snapshot.error;
      this.dispatchEvent(new CustomEvent("meteo-error", { detail: { error: snapshot.error } }));
    }
    this.#notify();
  }
}
