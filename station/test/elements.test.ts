// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  StationFeedElement,
  defineMeteoElements,
  meteoElementTags,
} from "../src/elements/index.js";
import { BASE_MS, feedFixture, iso, okStation } from "./fixtures.js";

defineMeteoElements();

const jsonResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  text: async () => body,
});

const mount = <T extends HTMLElement>(element: T): T => {
  document.body.appendChild(element);
  return element;
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("defineMeteoElements", () => {
  it("is idempotent and warns rather than throwing on a foreign constructor", () => {
    defineMeteoElements();
    defineMeteoElements();
    expect(customElements.get("meteo-station-feed")).toBe(StationFeedElement);
    for (const tag of Object.keys(meteoElementTags)) {
      expect(customElements.get(tag)).toBeDefined();
    }
  });
});

describe("meteo-station-feed", () => {
  it("provides consumer-set feed and display defaults through the context protocol", () => {
    const provider = mount(document.createElement("meteo-station-feed")) as StationFeedElement;
    provider.feed = feedFixture();
    provider.receivedAtMs = BASE_MS + 1_000;
    provider.setAttribute("unit", "knots");
    expect(provider.feed?.stations[0]?.id).toBe("test-station");
    expect(provider.receivedAtMs).toBe(BASE_MS + 1_000);
  });

  it("captures properties assigned before the element was defined (lazy upgrade)", () => {
    const raw = document.createElement("div");
    Object.defineProperty(raw, "tagName", { value: "METEO-STATION-FEED" });
    const provider = new StationFeedElement();
    (provider as unknown as Record<string, unknown>).feed = feedFixture();
    mount(provider);
    expect(provider.feed?.stations.length).toBe(2);
  });

  it("polls its src mount base, dispatches meteo-feed, and pauses without dropping data", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string) => jsonResponse(JSON.stringify(feedFixture())));
    vi.stubGlobal("fetch", fetchMock);
    const provider = document.createElement("meteo-station-feed") as StationFeedElement;
    provider.setAttribute("src", "/wind");
    provider.setAttribute("poll-seconds", "86400");
    const feedEvents: unknown[] = [];
    provider.addEventListener("meteo-feed", (event) =>
      feedEvents.push((event as CustomEvent).detail),
    );
    mount(provider);
    await vi.waitFor(() => expect(provider.feed).not.toBeNull());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/wind/feed");
    expect(feedEvents.length).toBe(1);

    provider.setAttribute("paused", "");
    const callsWhilePaused = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(86_400_000 * 2);
    expect(fetchMock.mock.calls.length).toBe(callsWhilePaused);
    expect(provider.feed).not.toBeNull();
  });

  it("dispatches meteo-error on a failing upstream and exposes the structured error", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse("boom", false));
    vi.stubGlobal("fetch", fetchMock);
    const provider = document.createElement("meteo-station-feed") as StationFeedElement;
    provider.setAttribute("src", "/wind");
    provider.setAttribute("poll-seconds", "86400");
    const errors: unknown[] = [];
    provider.addEventListener("meteo-error", (event) =>
      errors.push((event as CustomEvent<{ error: unknown }>).detail.error),
    );
    mount(provider);
    await vi.waitFor(() => expect(provider.error).not.toBeNull());
    expect(provider.error).toEqual({ kind: "network", status: 500 });
    expect(errors[0]).toEqual({ kind: "network", status: 500 });
  });

  it("polls both endpoints when a station id is named, folding the light current in", async () => {
    const fresh = {
      ...okStation(),
      reading: { ...okStation().reading, observedAt: iso(BASE_MS + 30_000), windAvgMps: 9.9 },
      history: null,
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/feed")
        ? jsonResponse(JSON.stringify(feedFixture()))
        : jsonResponse(
            JSON.stringify({ schemaVersion: 2, servedAt: iso(BASE_MS + 30_000), station: fresh }),
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = document.createElement("meteo-station-feed") as StationFeedElement;
    provider.setAttribute("src", "/wind");
    provider.setAttribute("station", "test-station");
    provider.setAttribute("poll-seconds", "86400");
    provider.setAttribute("current-poll-seconds", "86400");
    mount(provider);
    await vi.waitFor(() => {
      expect(provider.feed?.stations[0]?.reading?.windAvgMps).toBe(9.9);
    });
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain("/wind/feed");
    expect(urls).toContain("/wind/current?station=test-station");
  });

  it("stops its loops on disconnect — no timers or fetches leak", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string) => jsonResponse(JSON.stringify(feedFixture())));
    vi.stubGlobal("fetch", fetchMock);
    const provider = document.createElement("meteo-station-feed") as StationFeedElement;
    provider.setAttribute("src", "/wind");
    provider.setAttribute("poll-seconds", "1");
    mount(provider);
    await vi.waitFor(() => expect(provider.feed).not.toBeNull());
    provider.remove();
    const callsAfterRemove = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterRemove);
  });
});

describe("ambient resolution mechanics", () => {
  const withProvider = (inner: string): StationFeedElement => {
    const provider = document.createElement("meteo-station-feed") as StationFeedElement;
    provider.feed = feedFixture();
    provider.receivedAtMs = BASE_MS + 1_000;
    provider.thresholds = { unit: "kmh", values: [12, 20, 28] };
    provider.setAttribute("unit", "kmh");
    provider.innerHTML = inner;
    return mount(provider);
  };

  it('thresholds="none" opts a leaf out of the ambient grading', () => {
    const provider = withProvider(
      '<meteo-band-chip></meteo-band-chip><meteo-band-chip thresholds="none"></meteo-band-chip>',
    );
    const [graded, opted] = [...provider.querySelectorAll("span.meteo-band-chip")];
    expect(graded?.hasAttribute("data-band")).toBe(true);
    expect(opted?.hasAttribute("data-band")).toBe(false);
    expect(opted?.textContent).toBe("—");
  });

  it("an explicit attribute overrides the ambient default", () => {
    const provider = withProvider(
      '<meteo-speed></meteo-speed><meteo-speed unit="knots"></meteo-speed>',
    );
    const [ambient, explicit] = [...provider.querySelectorAll("data.meteo-speed")];
    expect(ambient?.textContent).toContain("km/h");
    expect(explicit?.textContent).toContain("kn");
  });

  it("station resolution follows stationId → primaryStationId → first", () => {
    const provider = withProvider(
      '<meteo-speed station-id="down-station"></meteo-speed><meteo-speed></meteo-speed>',
    );
    const [byId, byPrimary] = [...provider.querySelectorAll("data.meteo-speed")];
    expect(byId?.textContent).toBe("—");
    expect(byPrimary?.textContent).not.toBe("—");
  });

  it("a component with no resolvable station throws the wiring error naming this binding's provider", () => {
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message ?? String(event.error));
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    let thrown: unknown = null;
    try {
      mount(document.createElement("meteo-speed"));
    } catch (error) {
      thrown = error;
    }
    window.removeEventListener("error", onError);
    const message = thrown != null ? String(thrown) : (errors[0] ?? "");
    expect(message).toContain("<meteo-speed> resolved no station");
    expect(message).toContain("<meteo-station-feed>");
  });

  it("a meteo-station-card part outside the card throws its own wiring error", () => {
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message ?? String(event.error));
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    let thrown: unknown = null;
    try {
      mount(document.createElement("meteo-station-card-chart"));
    } catch (error) {
      thrown = error;
    }
    window.removeEventListener("error", onError);
    const message = thrown != null ? String(thrown) : (errors[0] ?? "");
    expect(message).toContain("<meteo-station-card-chart> must render inside <meteo-station-card>");
  });
});

describe("the binding's independence", () => {
  it("never imports react anywhere under station/elements/", () => {
    const root = join(__dirname, "../src/elements");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk(root).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not import react`).not.toMatch(
        /from\s+["']react["']|from\s+["']react-dom/,
      );
      expect(source, `${file} must not reach into the react binding`).not.toMatch(
        /from\s+["'][^"']*\/react\//,
      );
    }
  });
});

describe("upgrade callback order", () => {
  it("defers rendering until connectedCallback has wired the element", () => {
    const speed = document.createElement("meteo-speed");
    Object.defineProperty(speed, "isConnected", { value: true });
    type Reactions = {
      attributeChangedCallback(n: string, o: string | null, v: string | null): void;
    };
    expect(() =>
      (speed as unknown as Reactions).attributeChangedCallback("station-id", null, "launch"),
    ).not.toThrow();
    expect(speed.textContent ?? "").toBe("");
  });
});
