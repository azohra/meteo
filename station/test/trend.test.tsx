// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrendChart } from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import { makePoints, okStation } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

const mockChartBounds = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 120,
    right: 360,
    width: 360,
    height: 120,
    toJSON: () => ({}),
  } as DOMRect);

const withPressure = () =>
  okStation({
    history: {
      periodMinutes: 5,
      points: makePoints(12, (point, index) => ({
        ...point,
        seaLevelPressureHpa: 1009 + (index / 11) * 4,
      })),
    },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TrendChart", () => {
  it("draws one unbroken temperature trace with padded axis labels and 5 time ticks", () => {
    const { container } = render(<TrendChart series="temperature" station={okStation()} />);
    expect(container.querySelectorAll("polyline.meteo-trend-line").length).toBe(1);
    const gridLabels = Array.from(container.querySelectorAll(".meteo-grid-label")).map(
      (label) => label.textContent,
    );
    expect(gridLabels).toEqual(["11", "12", "13"]);
    expect(container.querySelectorAll(".meteo-tick").length).toBe(5);
    expect(container.querySelector(".meteo-trend-svg")?.getAttribute("aria-label")).toBe(
      defaultStrings.aria.trend(okStation().name, defaultStrings.trendTemperature),
    );
  });

  it("pads the pressure axis by at least ±2 hPa around the data range", () => {
    const { container } = render(<TrendChart series="pressure" station={withPressure()} />);
    const gridLabels = Array.from(container.querySelectorAll(".meteo-grid-label")).map(
      (label) => label.textContent,
    );
    expect(gridLabels).toEqual(["1007", "1011", "1015"]);
  });

  it("breaks the trace at null values — a lone sample between gaps is a dot", () => {
    const holes = new Set([4, 5, 7, 8]);
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point, index) =>
          holes.has(index) ? { ...point, temperatureC: null } : point,
        ),
      },
    });
    const { container } = render(<TrendChart series="temperature" station={station} />);
    expect(container.querySelectorAll("polyline.meteo-trend-line").length).toBe(2);
    expect(container.querySelectorAll("circle.meteo-trend-dot").length).toBe(1);
  });

  it("breaks the trace at dropouts found against the declared period", () => {
    const points = makePoints(12).filter((_, index) => index < 4 || index > 7);
    const station = okStation({ history: { periodMinutes: 5, points } });
    const { container } = render(<TrendChart series="temperature" station={station} />);
    expect(container.querySelectorAll("polyline.meteo-trend-line").length).toBe(2);
  });

  it("says 'not measured here' when history never carries the series", () => {
    const { container } = render(<TrendChart series="pressure" station={okStation()} />);
    expect(container.querySelector(".meteo-trend-na")?.textContent).toBe(
      defaultStrings.notMeasured,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing without the history capability, a note when history is thin", () => {
    const undeclared = okStation({
      capabilities: { gustLull: true, temperature: true, conditions: false, history: false },
      history: null,
    });
    const { container: empty } = render(<TrendChart series="temperature" station={undeclared} />);
    expect(empty.firstChild).toBeNull();

    const thin = okStation({ history: { periodMinutes: 5, points: makePoints(1) } });
    const { container: note } = render(<TrendChart series="temperature" station={thin} />);
    expect(note.querySelector(".meteo-trend-na")?.textContent).toBe(defaultStrings.noHistory);
  });

  it("pins an inspected sample and reads value with unit and time", () => {
    mockChartBounds();
    const station = withPressure();
    const { container } = render(
      <TrendChart formatTime={isoTime} series="pressure" station={station} />,
    );
    const readout = () => container.querySelector(".meteo-trend-readout");
    expect(readout()?.textContent).toContain(defaultStrings.inspectHint);

    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    const newest = station.history?.points[11];
    expect(readout()?.querySelector("strong")?.textContent).toBe(
      isoTime(new Date(newest?.observedAt as string)),
    );
    expect(readout()?.textContent).toContain(
      `${defaultStrings.trendPressure} 1013.0 ${defaultStrings.air.unitHpa}`,
    );

    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    expect(readout()?.textContent).toContain(defaultStrings.inspectHint);
  });
});
