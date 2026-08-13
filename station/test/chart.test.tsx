// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindHistoryChart } from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import { MINUTE_MS, iso, makePoints, okStation } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

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

const slidPoints = (periods: number) =>
  makePoints(12).map((point) => ({
    ...point,
    observedAt: iso(Date.parse(point.observedAt) + periods * 5 * MINUTE_MS),
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindHistoryChart", () => {
  it("draws band, single mean polyline, vanes, and ticks without thresholds", () => {
    const { container } = render(<WindHistoryChart station={okStation()} />);
    expect(container.querySelector("polygon.meteo-wind-band")).not.toBeNull();
    expect(container.querySelector("polyline.meteo-wind-mean")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-mean-segment")).toBeNull();
    expect(container.querySelector(".meteo-wind-zone")).toBeNull();
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".meteo-tick").length).toBe(5);
  });

  it("grades the mean per segment, tints band zones, and labels threshold guides", () => {
    const { container } = render(
      <WindHistoryChart station={okStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    expect(container.querySelector("polyline.meteo-wind-mean")).toBeNull();
    expect(container.querySelectorAll(".meteo-wind-mean-segment").length).toBe(11);
    expect(container.querySelector(".meteo-wind-mean-segment.meteo-band-0")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-mean-segment.meteo-band-2")).not.toBeNull();
    expect(container.querySelectorAll(".meteo-wind-threshold").length).toBe(2);
    expect(container.querySelector(".meteo-wind-threshold.meteo-band-1")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-threshold-label.meteo-band-2")?.textContent).toBe(
      "20",
    );
    expect(container.querySelectorAll(".meteo-wind-zone").length).toBe(3);
    expect(container.querySelector(".meteo-wind-zone.meteo-band-0")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-zone.meteo-band-2")).not.toBeNull();
  });

  it("rounds the axis in the DISPLAY unit and prints declared threshold numbers", () => {
    const { container } = render(
      <WindHistoryChart
        station={okStation()}
        thresholds={{ unit: "kmh", values: [12, 20] }}
        unit="knots"
      />,
    );
    const gridLabels = Array.from(container.querySelectorAll(".meteo-grid-label")).map(
      (label) => label.textContent,
    );
    expect(gridLabels).toEqual(["0", "8", "15"]);
    expect(container.querySelector(".meteo-wind-threshold-label.meteo-band-2")?.textContent).toBe(
      "11",
    );

    const { container: knotsDeclared } = render(
      <WindHistoryChart
        station={okStation()}
        thresholds={{ unit: "knots", values: [7.5] }}
        unit="knots"
      />,
    );
    expect(
      knotsDeclared.querySelector(".meteo-wind-threshold-label.meteo-band-1")?.textContent,
    ).toBe("7.5");
  });

  it("drops the band when any point lacks the gust-lull pair", () => {
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point, index) =>
          index === 4 ? { ...point, windGustMps: null } : point,
        ),
      },
    });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelector("polygon.meteo-wind-band")).toBeNull();
    expect(container.querySelector("polyline.meteo-wind-mean")).not.toBeNull();
  });

  it("says calm in words and dashes the vane row", () => {
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({
          ...point,
          windAvgMps: 0,
          windGustMps: 0,
          windLullMps: 0,
          windDirectionDeg: null,
        })),
      },
    });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelector(".meteo-wind-calm-note")?.textContent).toBe(
      defaultStrings.calmHistory,
    );
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBe(0);
    expect(container.querySelectorAll(".meteo-wind-vane-calm").length).toBeGreaterThan(0);
  });

  it("hatches dropout gaps found against the declared period", () => {
    const points = makePoints(12).filter((_, index) => index < 4 || index > 7);
    const station = okStation({ history: { periodMinutes: 5, points } });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelectorAll("rect.meteo-wind-gap").length).toBe(1);
  });

  it("renders nothing when the station declares no history, a note when history is thin", () => {
    const undeclared = okStation({
      capabilities: { gustLull: true, temperature: true, conditions: false, history: false },
      history: null,
    });
    const { container: empty } = render(<WindHistoryChart station={undeclared} />);
    expect(empty.firstChild).toBeNull();

    const thin = okStation({ history: { periodMinutes: 5, points: makePoints(1) } });
    const { container: note } = render(<WindHistoryChart station={thin} />);
    expect(note.querySelector(".meteo-wind-chart-na")?.textContent).toBe(defaultStrings.noHistory);
  });

  it("labels the readout live region and keeps it quiet only while previewing", () => {
    const { container } = render(<WindHistoryChart station={okStation()} />);
    const readout = container.querySelector("output.meteo-wind-chart-readout");
    expect(readout?.getAttribute("aria-label")).toBe(defaultStrings.aria.readout(okStation().name));
    expect(readout?.getAttribute("aria-live")).toBe("polite");
  });

  it("pins by timestamp so a sliding window keeps the same moment, then clears when it leaves", () => {
    mockChartBounds();
    const BASE_MS = Date.parse(makePoints(12)[11]!.observedAt);
    const { container, rerender } = render(
      <WindHistoryChart formatTime={isoTime} station={okStation()} />,
    );
    const hit = container.querySelector(".meteo-hit") as SVGRectElement;
    fireEvent.click(hit, { clientX: 354 });
    const readout = () => container.querySelector(".meteo-wind-chart-readout");
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(BASE_MS)));
    expect(readout()?.textContent).toContain(`${defaultStrings.avgLabel} 21`);

    const slid = okStation({ history: { periodMinutes: 5, points: slidPoints(1) } });
    rerender(<WindHistoryChart formatTime={isoTime} station={slid} />);
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(BASE_MS)));
    expect(readout()?.textContent).toContain(`${defaultStrings.avgLabel} 20`);

    const gone = okStation({ history: { periodMinutes: 5, points: slidPoints(20) } });
    rerender(<WindHistoryChart formatTime={isoTime} station={gone} />);
    expect(readout()?.textContent).toContain(defaultStrings.inspectHint);
  });

  it("reads calm below the WMO threshold and an em dash for a blowing vaneless sample", () => {
    mockChartBounds();
    const calmish = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({
          ...point,
          windAvgMps: 1 / 3.6,
          windGustMps: 1.4 / 3.6,
          windLullMps: 0.5 / 3.6,
          windDirectionDeg: 45,
        })),
      },
    });
    const { container } = render(<WindHistoryChart formatTime={isoTime} station={calmish} />);
    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    expect(container.querySelector(".meteo-wind-chart-readout")?.textContent).toContain(
      defaultStrings.calm,
    );

    const vaneless = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({ ...point, windDirectionDeg: null })),
      },
    });
    const { container: dashed } = render(
      <WindHistoryChart formatTime={isoTime} station={vaneless} />,
    );
    fireEvent.click(dashed.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    const text = dashed.querySelector(".meteo-wind-chart-readout")?.textContent ?? "";
    expect(text).not.toContain(defaultStrings.calm);
    expect(text.trim().endsWith("—")).toBe(true);
  });

  it("honours an explicit plotHeight without forking the frame's row math", () => {
    const { container: standard } = render(<WindHistoryChart station={okStation()} />);
    expect(standard.querySelector(".meteo-wind-chart-svg")?.getAttribute("height")).toBe("150");

    const { container: tall } = render(<WindHistoryChart plotHeight={160} station={okStation()} />);
    expect(tall.querySelector(".meteo-wind-chart-svg")?.getAttribute("height")).toBe("234");
  });
});
