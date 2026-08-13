// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { defaultStrings } from "../src/index.js";
import type { HistoryPoint, Station } from "../src/index.js";
import {
  AirMatrix,
  BandChip,
  CurrentConditions,
  DailyPattern,
  Dial,
  Direction,
  FreshnessBadge,
  Gust,
  Lull,
  Pressure,
  Speed,
  Sparkline,
  StationStrip,
  StationTable,
  Temperature,
  TrendChart,
  UpdatedAt,
  WindArrow,
  WindHistoryChart,
  WindRose,
  StationCard,
} from "../src/react/index.js";
import { defineMeteoElements } from "../src/elements/index.js";
import {
  BASE_MS,
  conditionsStation,
  downStation,
  feedFixture,
  iso,
  makePoints,
  okStation,
} from "./fixtures.js";

defineMeteoElements();

function unwrapHosts(root: Element): void {
  for (const host of [...root.querySelectorAll("*")]) {
    if (host.localName.startsWith("meteo-")) host.replaceWith(...host.childNodes);
  }
}

function canonicalizeIds(root: Element): void {
  const mapping = new Map<string, string>();
  for (const carrier of [...root.querySelectorAll("[id]")]) {
    const id = carrier.getAttribute("id") as string;
    const canonical = mapping.get(id) ?? `generated-${mapping.size}`;
    mapping.set(id, canonical);
    carrier.setAttribute("id", canonical);
  }
  if (mapping.size === 0) return;
  for (const element of [...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value;
      for (const [before, after] of mapping) {
        if (value === before) value = after;
        value = value.replaceAll(`url(#${before})`, `url(#${after})`);
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return JSON.stringify((node as Text).data);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const attrs = [...element.attributes]
    .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .sort()
    .join(" ");
  const children = [...element.childNodes].map(serializeNode).join("");
  return `<${element.localName}${attrs ? ` ${attrs}` : ""}>${children}</${element.localName}>`;
}

function normalize(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  const wrapper = document.createElement("div");
  wrapper.append(...clone.childNodes);
  unwrapHosts(wrapper);
  canonicalizeIds(wrapper);
  wrapper.normalize();
  return [...wrapper.childNodes].map(serializeNode).join("");
}

type AnyElement = HTMLElement & Record<string, unknown>;

function renderBoth(
  react: ReactElement,
  tag: string,
  setup?: (element: AnyElement) => void,
): { reactDom: string; elementDom: string } {
  const { container } = render(react);
  const element = document.createElement(tag) as AnyElement;
  setup?.(element);
  document.body.appendChild(element);
  const result = { reactDom: normalize(container), elementDom: normalize(element) };
  element.remove();
  return result;
}

function expectParity(
  react: ReactElement,
  tag: string,
  setup?: (element: AnyElement) => void,
): void {
  const { reactDom, elementDom } = renderBoth(react, tag, setup);
  expect(elementDom).toBe(reactDom);
  expect(elementDom.length).toBeGreaterThan(0);
}

const calmStation = (): Station =>
  okStation({
    reading: { ...okStation().reading, windAvgMps: 0.2, windDirectionDeg: null, windGustMps: 0.4 },
  });

const gapStation = (): Station =>
  okStation({
    history: {
      periodMinutes: 10,
      points: makePoints(8).map((point, index) =>
        index < 4 ? point : { ...point, observedAt: iso(Date.parse(point.observedAt) + 3_600_000) },
      ),
    },
  });

const thresholds = { unit: "kmh" as const, values: [12, 20, 28] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS + 90_000);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("parity: visual atoms", () => {
  it("WindArrow", () => {
    expectParity(<WindArrow deg={312} />, "meteo-wind-arrow", (el) =>
      el.setAttribute("deg", "312"),
    );
    expectParity(<WindArrow deg={12} size={20} />, "meteo-wind-arrow", (el) => {
      el.setAttribute("deg", "12");
      el.setAttribute("size", "20");
    });
  });

  it("FreshnessBadge", () => {
    for (const status of ["live", "aging", "stale"] as const) {
      expectParity(<FreshnessBadge status={status} />, "meteo-freshness-badge", (el) =>
        el.setAttribute("status", status),
      );
    }
  });

  it("Dial — ok, banded, calm, unavailable", () => {
    expectParity(<Dial station={okStation()} />, "meteo-dial", (el) => {
      el.station = okStation();
    });
    expectParity(
      <Dial station={okStation()} thresholds={thresholds} unit="knots" />,
      "meteo-dial",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    expectParity(<Dial station={calmStation()} />, "meteo-dial", (el) => {
      el.station = calmStation();
    });
    expectParity(<Dial calmWord={false} station={calmStation()} />, "meteo-dial", (el) => {
      el.station = calmStation();
      el.setAttribute("no-calm-word", "");
    });
    expectParity(<Dial station={downStation()} />, "meteo-dial", (el) => {
      el.station = downStation();
    });
  });

  it("Sparkline — plain, banded, band off, gaps, no history", () => {
    expectParity(<Sparkline station={okStation()} />, "meteo-sparkline", (el) => {
      el.station = okStation();
    });
    expectParity(
      <Sparkline station={okStation()} thresholds={thresholds} />,
      "meteo-sparkline",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<Sparkline showBand={false} station={gapStation()} />, "meteo-sparkline", (el) => {
      el.station = gapStation();
      el.setAttribute("no-band", "");
    });
    expectParity(<Sparkline station={downStation()} />, "meteo-sparkline", (el) => {
      el.station = downStation();
    });
  });

  it("WindRose — ok, thresholds, favorable ring, no history", () => {
    const favorable = [{ fromDeg: 260, toDeg: 340 }];
    expectParity(<WindRose station={okStation()} />, "meteo-wind-rose", (el) => {
      el.station = okStation();
    });
    expectParity(
      <WindRose favorableDirections={favorable} station={okStation()} thresholds={thresholds} />,
      "meteo-wind-rose",
      (el) => {
        el.station = okStation();
        el.favorableDirections = favorable;
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<WindRose points={makePoints(6)} />, "meteo-wind-rose", (el) => {
      el.points = makePoints(6);
    });
    expectParity(<WindRose station={downStation()} />, "meteo-wind-rose", (el) => {
      el.station = downStation();
    });
  });
});

describe("parity: text atoms", () => {
  const stations: Array<[string, () => Station]> = [
    ["ok", okStation],
    ["down", downStation],
    ["calm", calmStation],
    ["conditions", conditionsStation],
  ];

  it("Speed / Gust / Lull", () => {
    for (const [, make] of stations) {
      expectParity(<Speed station={make()} />, "meteo-speed", (el) => {
        el.station = make();
      });
      expectParity(<Gust station={make()} unit="knots" />, "meteo-gust", (el) => {
        el.station = make();
        el.setAttribute("unit", "knots");
      });
      expectParity(<Lull station={make()} />, "meteo-lull", (el) => {
        el.station = make();
      });
    }
  });

  it("Temperature / Pressure / Direction", () => {
    for (const [, make] of stations) {
      expectParity(<Temperature station={make()} />, "meteo-temperature", (el) => {
        el.station = make();
      });
      expectParity(<Pressure station={make()} />, "meteo-pressure", (el) => {
        el.station = make();
      });
      expectParity(<Direction station={make()} />, "meteo-direction", (el) => {
        el.station = make();
      });
    }
  });

  it("UpdatedAt — relative, server-anchored, unavailable", () => {
    expectParity(
      <UpdatedAt
        receivedAtMs={BASE_MS + 60_000}
        servedAt={iso(BASE_MS + 30_000)}
        station={okStation()}
      />,
      "meteo-updated-at",
      (el) => {
        el.station = okStation();
        el.setAttribute("served-at", iso(BASE_MS + 30_000));
        el.setAttribute("received-at-ms", String(BASE_MS + 60_000));
      },
    );
    expectParity(<UpdatedAt station={downStation()} />, "meteo-updated-at", (el) => {
      el.station = downStation();
    });
  });

  it("BandChip — graded, labelled, calm, ungradeable", () => {
    expectParity(
      <BandChip station={okStation()} thresholds={thresholds} />,
      "meteo-band-chip",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    const labels = ["light", "soarable", "strong", "nuking"];
    expectParity(
      <BandChip labels={labels} station={okStation()} thresholds={thresholds} />,
      "meteo-band-chip",
      (el) => {
        el.station = okStation();
        el.labels = labels;
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(
      <BandChip station={calmStation()} thresholds={thresholds} />,
      "meteo-band-chip",
      (el) => {
        el.station = calmStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<BandChip station={okStation()} />, "meteo-band-chip", (el) => {
      el.station = okStation();
    });
  });
});

describe("parity: composites", () => {
  const servedAt = iso(BASE_MS + 30_000);
  const receivedAtMs = BASE_MS + 60_000;

  it("CurrentConditions — ok, banded, calm, wind-only, unavailable", () => {
    const windOnly = () =>
      okStation({
        capabilities: { ...okStation().capabilities, gustLull: false, temperature: false },
      });
    for (const make of [okStation, calmStation, windOnly, downStation]) {
      expectParity(
        <CurrentConditions
          receivedAtMs={receivedAtMs}
          servedAt={servedAt}
          station={make()}
          thresholds={thresholds}
          unit="knots"
        />,
        "meteo-current-conditions",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
          el.setAttribute("thresholds", JSON.stringify(thresholds));
          el.setAttribute("unit", "knots");
        },
      );
    }
  });

  it("StationStrip — ok and unavailable", () => {
    for (const make of [okStation, downStation, calmStation]) {
      expectParity(
        <StationStrip receivedAtMs={receivedAtMs} servedAt={servedAt} station={make()} />,
        "meteo-station-strip",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
        },
      );
    }
  });

  it("StationTable — default meta, custom stationMeta, degraded row", () => {
    const stations = [okStation(), downStation()];
    expectParity(
      <StationTable receivedAtMs={receivedAtMs} servedAt={servedAt} stations={stations} />,
      "meteo-station-table",
      (el) => {
        el.stations = stations;
        el.setAttribute("served-at", servedAt);
        el.setAttribute("received-at-ms", String(receivedAtMs));
      },
    );
    const meta = (station: Station) => (station.status === "ok" ? "past 3 s" : null);
    expectParity(
      <StationTable
        receivedAtMs={receivedAtMs}
        servedAt={servedAt}
        stationMeta={meta}
        stations={stations}
      />,
      "meteo-station-table",
      (el) => {
        el.stations = stations;
        el.stationMeta = meta;
        el.setAttribute("served-at", servedAt);
        el.setAttribute("received-at-ms", String(receivedAtMs));
      },
    );
  });

  it("AirMatrix — collapsed, and empty without conditions-capable stations", () => {
    const stations = [conditionsStation(), okStation(), downStation()];
    expectParity(<AirMatrix stations={stations} />, "meteo-air-matrix", (el) => {
      el.stations = stations;
    });
    const { reactDom, elementDom } = renderBoth(
      <AirMatrix stations={[downStation()]} />,
      "meteo-air-matrix",
      (el) => {
        el.stations = [downStation()];
      },
    );
    expect(reactDom).toBe("");
    expect(elementDom).toBe("");
  });

  it("AirMatrix — expanded panels match after a click on each binding's trigger", () => {
    const stations = [conditionsStation()];
    const { container } = render(<AirMatrix stations={stations} />);
    fireEvent.click(container.querySelector("button.meteo-air-trigger") as HTMLButtonElement);

    const element = document.createElement("meteo-air-matrix") as AnyElement;
    element.stations = stations;
    document.body.appendChild(element);
    (element.querySelector("button.meteo-air-trigger") as HTMLButtonElement).click();

    expect(normalize(element)).toBe(normalize(container));
    expect(normalize(element)).toContain('data-expanded="true"');
    element.remove();
  });
});

describe("parity: charts (fallback width, initial render)", () => {
  it("WindHistoryChart — plain, banded in knots, calm, thin history, no capability", () => {
    const plain = renderBoth(
      <WindHistoryChart station={okStation()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = okStation();
      },
    );
    expect(plain.elementDom).toBe(plain.reactDom);
    expect(plain.reactDom).toContain("meteo-wind-vane-label");
    expect(plain.reactDom).toContain("meteo-wind-vane-value");
    expectParity(
      <WindHistoryChart station={okStation()} thresholds={thresholds} unit="knots" />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    expectParity(
      <WindHistoryChart plotHeight={200} station={gapStation()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = gapStation();
        el.setAttribute("plot-height", "200");
      },
    );
    const calmHistory = () =>
      okStation({
        history: {
          periodMinutes: 10,
          points: makePoints(6).map((point) => ({
            ...point,
            windAvgMps: 0,
            windGustMps: 0.2,
            windLullMps: 0,
            windDirectionDeg: null,
          })),
        },
      });
    const calm = renderBoth(
      <WindHistoryChart station={calmHistory()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = calmHistory();
      },
    );
    expect(calm.elementDom).toBe(calm.reactDom);
    expect(calm.reactDom).toContain(`class="meteo-wind-vane-label" text-anchor="middle"`);
    expect(calm.reactDom.match(/class="meteo-wind-vane-label"[^>]*>"—"</g)?.length).toBe(
      calm.reactDom.match(/class="meteo-wind-vane-calm"/g)?.length,
    );
    const thin = () => okStation({ history: { periodMinutes: 10, points: makePoints(1) } });
    expectParity(<WindHistoryChart station={thin()} />, "meteo-wind-history-chart", (el) => {
      el.station = thin();
    });
    const noHistoryCapability = () =>
      okStation({
        capabilities: { ...okStation().capabilities, history: false },
      });
    const { reactDom, elementDom } = renderBoth(
      <WindHistoryChart station={noHistoryCapability()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = noHistoryCapability();
      },
    );
    expect(reactDom).toBe("");
    expect(elementDom).toBe("");
  });

  it("WindHistoryChart — windowHours slices the display; compareOffsetDays overlays a prior day only when history covers it", () => {
    const denseStation = () => okStation({ history: { periodMinutes: 5, points: makePoints(84) } });
    const deepStation = () => okStation({ history: { periodMinutes: 5, points: makePoints(400) } });

    expectParity(
      <WindHistoryChart station={denseStation()} windowHours={6} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = denseStation();
        el.setAttribute("window-hours", "6");
      },
    );
    const full = renderBoth(
      <WindHistoryChart station={denseStation()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = denseStation();
      },
    );
    const windowed = renderBoth(
      <WindHistoryChart station={denseStation()} windowHours={6} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = denseStation();
        el.setAttribute("window-hours", "6");
      },
    );
    expect(windowed.reactDom).not.toBe(full.reactDom);

    const overlaid = renderBoth(
      <WindHistoryChart compareOffsetDays={1} station={deepStation()} windowHours={6} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = deepStation();
        el.setAttribute("compare-offset-days", "1");
        el.setAttribute("window-hours", "6");
      },
    );
    expect(overlaid.elementDom).toBe(overlaid.reactDom);
    expect(overlaid.reactDom).toContain("meteo-wind-compare");

    const omitted = renderBoth(
      <WindHistoryChart station={deepStation()} windowHours={6} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = deepStation();
        el.setAttribute("window-hours", "6");
      },
    );
    expect(omitted.elementDom).toBe(omitted.reactDom);
    expect(omitted.reactDom).not.toContain("meteo-wind-compare");

    const tooShallow = renderBoth(
      <WindHistoryChart compareOffsetDays={1} station={denseStation()} windowHours={6} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = denseStation();
        el.setAttribute("compare-offset-days", "1");
        el.setAttribute("window-hours", "6");
      },
    );
    expect(tooShallow.elementDom).toBe(tooShallow.reactDom);
    expect(tooShallow.reactDom).not.toContain("meteo-wind-compare");
  });

  it("TrendChart — temperature, pressure (not measured), thin history", () => {
    expectParity(
      <TrendChart series="temperature" station={okStation()} />,
      "meteo-trend-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("series", "temperature");
      },
    );
    expectParity(
      <TrendChart series="pressure" station={okStation()} />,
      "meteo-trend-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("series", "pressure");
      },
    );
    const thin = () => okStation({ history: { periodMinutes: 10, points: makePoints(1) } });
    expectParity(
      <TrendChart series="temperature" station={thin()} />,
      "meteo-trend-chart",
      (el) => {
        el.station = thin();
        el.setAttribute("series", "temperature");
      },
    );
  });

  it("DailyPattern — from a station (coverage caption, void slots), and from raw points", () => {
    const dailyPatternStation = () =>
      okStation({
        history: {
          periodMinutes: 180,
          points: makePoints(15).map((point, index) => ({
            ...point,
            observedAt: iso(BASE_MS - (15 - index) * 3 * 3_600_000),
          })),
        },
      });
    const base = renderBoth(
      <DailyPattern station={dailyPatternStation()} />,
      "meteo-daily-pattern",
      (el) => {
        el.station = dailyPatternStation();
      },
    );
    expect(base.elementDom).toBe(base.reactDom);
    expect(base.reactDom).toContain("meteo-wind-vane-label");
    expect(base.reactDom).toContain("meteo-wind-vane-value");
    expectParity(
      <DailyPattern
        slotMinutes={60}
        station={dailyPatternStation()}
        thresholds={thresholds}
        unit="knots"
      />,
      "meteo-daily-pattern",
      (el) => {
        el.station = dailyPatternStation();
        el.setAttribute("slot-minutes", "60");
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    expectParity(<DailyPattern points={makePoints(20)} />, "meteo-daily-pattern", (el) => {
      el.points = makePoints(20);
    });
    const { reactDom, elementDom } = renderBoth(
      <DailyPattern points={[]} />,
      "meteo-daily-pattern",
      (el) => {
        el.points = [];
      },
    );
    expect(reactDom).toBe(elementDom);
    expect(reactDom).toContain(defaultStrings.noHistory);
  });

  it("DailyPattern — the persistent Avg row dashes a genuinely void slot rather than a fabricated zero", () => {
    const twoSlotPoints: HistoryPoint[] = [
      {
        windAvgMps: 4,
        windDirectionDeg: 90,
        windGustMps: null,
        windLullMps: null,
        observedAt: iso(Date.parse("2026-08-01T00:30:00Z")),
        temperatureC: null,
      },
      {
        windAvgMps: 6,
        windDirectionDeg: 90,
        windGustMps: null,
        windLullMps: null,
        observedAt: iso(Date.parse("2026-08-02T00:30:00Z")),
        temperatureC: null,
      },
    ];
    const { reactDom, elementDom } = renderBoth(
      <DailyPattern points={twoSlotPoints} slotMinutes={360} />,
      "meteo-daily-pattern",
      (el) => {
        el.points = twoSlotPoints;
        el.setAttribute("slot-minutes", "360");
      },
    );
    expect(elementDom).toBe(reactDom);
    const voidDashes = reactDom.match(/class="meteo-wind-vane-value"[^>]*>"—"</g) ?? [];
    const realValues = reactDom.match(/class="meteo-wind-vane-value"[^>]*>"\d/g) ?? [];
    expect(voidDashes).toHaveLength(3);
    expect(realValues).toHaveLength(1);
  });
});

describe("parity: the StationCard compound", () => {
  const servedAt = iso(BASE_MS + 30_000);
  const receivedAtMs = BASE_MS + 60_000;

  it("default composition — the full card, ok and unavailable", () => {
    for (const make of [okStation, downStation]) {
      expectParity(
        <StationCard
          receivedAtMs={receivedAtMs}
          servedAt={servedAt}
          station={make()}
          thresholds={thresholds}
          unit="knots"
        />,
        "meteo-station-card",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
          el.setAttribute("thresholds", JSON.stringify(thresholds));
          el.setAttribute("unit", "knots");
        },
      );
    }
  });

  it("composed subset — only the asked-for pieces, with a part-level thresholds opt-out", () => {
    const { container } = render(
      <StationCard
        receivedAtMs={receivedAtMs}
        servedAt={servedAt}
        station={okStation()}
        thresholds={thresholds}
      >
        <StationCard.Header />
        <StationCard.Chart thresholds={null} />
        <StationCard.Summary />
      </StationCard>,
    );

    const element = document.createElement("meteo-station-card") as AnyElement;
    element.innerHTML =
      "<meteo-station-card-header></meteo-station-card-header>" +
      '<meteo-station-card-chart thresholds="none"></meteo-station-card-chart>' +
      "<meteo-station-card-summary></meteo-station-card-summary>";
    element.station = okStation();
    element.setAttribute("served-at", servedAt);
    element.setAttribute("received-at-ms", String(receivedAtMs));
    element.setAttribute("thresholds", JSON.stringify(thresholds));
    document.body.appendChild(element);

    expect(normalize(element)).toBe(normalize(container));
    expect(normalize(element)).not.toContain("meteo-wind-zone");
    element.remove();
  });

  it("authored-but-empty means an empty card, not the default composition", () => {
    const { container } = render(<StationCard station={okStation()}>{false}</StationCard>);
    const element = document.createElement("meteo-station-card") as AnyElement;
    element.setAttribute("compose", "");
    element.station = okStation();
    document.body.appendChild(element);
    expect(normalize(element)).toBe(normalize(container));
    expect(normalize(element)).not.toContain("meteo-station-card-header");
    element.remove();
  });
});

describe("parity: ambient defaults flow alike", () => {
  it("a provider's unit and thresholds grade both bindings identically", async () => {
    const feed = feedFixture([conditionsStation(), downStation()]);
    const { StationFeedProvider } = await import("../src/react/index.js");
    const { container } = render(
      <StationFeedProvider
        feed={feed}
        receivedAtMs={BASE_MS + 60_000}
        thresholds={thresholds}
        unit="knots"
      >
        <Speed />
        <BandChip />
      </StationFeedProvider>,
    );

    const provider = document.createElement("meteo-station-feed") as AnyElement;
    provider.feed = feed;
    provider.receivedAtMs = BASE_MS + 60_000;
    provider.thresholds = thresholds;
    provider.setAttribute("unit", "knots");
    provider.innerHTML = "<meteo-speed></meteo-speed><meteo-band-chip></meteo-band-chip>";
    document.body.appendChild(provider);

    expect(normalize(provider)).toBe(normalize(container));
  });
});
