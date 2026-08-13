// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineMeteoElements } from "../src/elements/index.js";
import type { TrendChartElement, WindHistoryChartElement } from "../src/elements/index.js";
import { MINUTE_MS, iso, makePoints, okStation } from "./fixtures.js";

defineMeteoElements();

const mockChartBounds = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 180,
    right: 360,
    width: 360,
    height: 180,
    toJSON: () => ({}),
  } as DOMRect);

const slidStation = (periods: number) =>
  okStation({
    history: {
      periodMinutes: 5,
      points: makePoints(12).map((point) => ({
        ...point,
        observedAt: iso(Date.parse(point.observedAt) + periods * 5 * MINUTE_MS),
      })),
    },
  });

const mountChart = (): WindHistoryChartElement => {
  const element = document.createElement("meteo-wind-history-chart") as WindHistoryChartElement;
  element.station = okStation();
  document.body.appendChild(element);
  return element;
};

const hitOf = (element: HTMLElement): SVGRectElement =>
  element.querySelector("rect.meteo-hit") as SVGRectElement;

const readoutOf = (element: HTMLElement): HTMLOutputElement =>
  element.querySelector("output") as HTMLOutputElement;

const pointerMove = (target: Element, clientX: number, pointerType = "mouse") => {
  const event = new Event("pointermove", { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
};

const pointerLeave = (target: Element) => {
  target.dispatchEvent(new Event("pointerleave", { bubbles: true }));
};

const click = (target: Element, clientX: number) => {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX }));
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("meteo-wind-history-chart inspector", () => {
  it("previews on pointer move, announces nothing, and clears on leave", () => {
    mockChartBounds();
    const element = mountChart();
    const readout = readoutOf(element);
    const windowText = readout.textContent;
    expect(readout.getAttribute("aria-live")).toBe("polite");

    pointerMove(hitOf(element), 200);
    expect(readout.getAttribute("aria-live")).toBe("off");
    expect(readout.textContent).not.toBe(windowText);
    expect(readout.querySelector("strong")?.textContent).not.toContain("–");
    expect(element.querySelector(".meteo-cursor")).not.toBeNull();

    pointerLeave(hitOf(element));
    expect(readout.getAttribute("aria-live")).toBe("polite");
    expect(readout.textContent).toBe(windowText);
    expect(element.querySelector(".meteo-cursor")).toBeNull();
  });

  it("touch never previews, so a scroll stays a scroll", () => {
    mockChartBounds();
    const element = mountChart();
    const before = readoutOf(element).textContent;
    pointerMove(hitOf(element), 200, "touch");
    expect(readoutOf(element).textContent).toBe(before);
    expect(element.querySelector(".meteo-cursor")).toBeNull();
  });

  it("click pins, an identical click unpins, and the pin announces", () => {
    mockChartBounds();
    const element = mountChart();
    const readout = readoutOf(element);
    const windowText = readout.textContent;

    click(hitOf(element), 200);
    expect(readout.getAttribute("aria-live")).toBe("polite");
    const pinnedText = readout.textContent;
    expect(pinnedText).not.toBe(windowText);
    expect(element.querySelector(".meteo-cursor-dot")).not.toBeNull();

    click(hitOf(element), 200);
    expect(readout.textContent).toBe(windowText);
    expect(element.querySelector(".meteo-cursor-dot")).toBeNull();
  });

  it("a pin holds its TIMESTAMP under a sliding window and clears when the moment leaves", () => {
    mockChartBounds();
    const element = document.createElement("meteo-wind-history-chart") as WindHistoryChartElement;
    element.station = slidStation(0);
    document.body.appendChild(element);
    const readout = readoutOf(element);

    click(hitOf(element), 340);
    const pinnedMoment = readout.querySelector("strong")?.textContent;
    expect(pinnedMoment).not.toContain("–");

    element.station = slidStation(1);
    expect(readoutOf(element).querySelector("strong")?.textContent).toBe(pinnedMoment);
    expect(element.querySelector(".meteo-cursor")).not.toBeNull();

    element.station = slidStation(24);
    expect(readoutOf(element).querySelector("strong")?.textContent).toContain("–");
    expect(element.querySelector(".meteo-cursor")).toBeNull();
  });

  it("pointer chatter never re-creates the hit rect it rides on", () => {
    mockChartBounds();
    const element = mountChart();
    const hit = hitOf(element);
    for (const clientX of [100, 150, 200, 250, 300]) pointerMove(hit, clientX);
    click(hit, 220);
    expect(hitOf(element)).toBe(hit);
  });
});

describe("meteo-trend-chart inspector", () => {
  it("previews and pins over the temperature series", () => {
    mockChartBounds();
    const element = document.createElement("meteo-trend-chart") as TrendChartElement;
    element.station = okStation();
    element.setAttribute("series", "temperature");
    document.body.appendChild(element);
    const readout = readoutOf(element);
    const windowText = readout.textContent;

    pointerMove(hitOf(element), 200);
    expect(readout.getAttribute("aria-live")).toBe("off");
    expect(readout.textContent).toContain("Temperature");
    expect(readout.textContent).toContain("°C");

    click(hitOf(element), 200);
    expect(readout.getAttribute("aria-live")).toBe("polite");
    pointerLeave(hitOf(element));
    expect(readout.textContent).not.toBe(windowText);
    expect(element.querySelector(".meteo-cursor-dot")).not.toBeNull();
  });
});
