// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindSampleStrip } from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import type { LiveSample, LiveSamples } from "../src/index.js";
import { BASE_MS, iso } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

const mockStripBounds = () =>
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

function sample(
  offsetSeconds: number,
  windMps: number,
  windDirectionDeg: number | null = 270,
): LiveSample {
  return { observedAt: iso(BASE_MS + offsetSeconds * 1_000), windMps, windDirectionDeg };
}

/* Twelve samples at the 3-second cadence, climbing 10→21 km/h. */
function makeSamples(
  map: (point: LiveSample, index: number) => LiveSample = (point) => point,
): LiveSamples {
  return {
    intervalSeconds: 3,
    points: Array.from({ length: 12 }, (_, index) =>
      map(sample(index * 3, (10 + index) / 3.6), index),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindSampleStrip", () => {
  it("draws the history chart's structure over one unbroken run", () => {
    const { container } = render(<WindSampleStrip samples={makeSamples()} stationName="Launch" />);
    expect(container.querySelectorAll(".meteo-grid-line").length).toBe(3);
    expect(container.querySelectorAll("polyline.meteo-sample-trace").length).toBe(1);
    expect(container.querySelector(".meteo-sample-dot")).toBeNull();
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".meteo-wind-vane-label").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".meteo-wind-vane-value").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".meteo-wind-row-label").length).toBe(2);
    expect(container.querySelectorAll(".meteo-tick").length).toBe(5);
    expect(container.querySelector(".meteo-wind-band")).toBeNull();
    expect(container.querySelector(".meteo-wind-zone")).toBeNull();
  });

  it("anchors the edge time labels inward so they never clip", () => {
    const { container } = render(<WindSampleStrip samples={makeSamples()} stationName="Launch" />);
    const anchors = Array.from(container.querySelectorAll(".meteo-tick")).map((tick) =>
      tick.getAttribute("text-anchor"),
    );
    expect(anchors[0]).toBe("start");
    expect(anchors[anchors.length - 1]).toBe("end");
    expect(anchors.slice(1, -1)).toEqual(["middle", "middle", "middle"]);
  });

  it("splits the trace at a dropout and draws a one-sample run as a dot", () => {
    const samples: LiveSamples = {
      intervalSeconds: 3,
      points: [
        sample(0, 3),
        sample(3, 4),
        sample(6, 5),
        /* > 2.5 intervals of silence: a gap, never a zero. */
        sample(60, 4),
        sample(120, 5),
        sample(123, 6),
      ],
    };
    const { container } = render(<WindSampleStrip samples={samples} stationName="Launch" />);
    expect(container.querySelectorAll("polyline.meteo-sample-trace").length).toBe(2);
    expect(container.querySelectorAll("circle.meteo-sample-dot").length).toBe(1);
  });

  it("rounds the axis in the display unit", () => {
    const { container } = render(
      <WindSampleStrip samples={makeSamples()} stationName="Launch" unit="kmh" />,
    );
    const gridLabels = Array.from(container.querySelectorAll(".meteo-grid-label")).map(
      (label) => label.textContent,
    );
    expect(gridLabels).toEqual(["0", "13", "25"]);
  });

  it("says calm in words and dashes the vane row for an all-calm window", () => {
    const calm = makeSamples((point) => ({ ...point, windMps: 0.2, windDirectionDeg: null }));
    const { container } = render(<WindSampleStrip samples={calm} stationName="Launch" />);
    expect(container.querySelector(".meteo-wind-calm-note")?.textContent).toBe(
      defaultStrings.calmHistory,
    );
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBe(0);
    expect(container.querySelectorAll(".meteo-wind-vane-calm").length).toBeGreaterThan(0);
  });

  it("renders a note for a missing or thin window", () => {
    const { container: absent } = render(<WindSampleStrip samples={null} stationName="Launch" />);
    expect(absent.querySelector(".meteo-sample-strip-na")?.textContent).toBe(
      defaultStrings.noSamples,
    );

    const thin: LiveSamples = { intervalSeconds: 3, points: [sample(0, 2)] };
    const { container: note } = render(<WindSampleStrip samples={thin} stationName="Launch" />);
    expect(note.querySelector(".meteo-sample-strip-na")?.textContent).toBe(
      defaultStrings.noSamples,
    );
  });

  it("labels the readout live region and keeps it quiet only while previewing", () => {
    const { container } = render(<WindSampleStrip samples={makeSamples()} stationName="Launch" />);
    const readout = container.querySelector("output.meteo-sample-strip-readout");
    expect(readout?.getAttribute("aria-label")).toBe(defaultStrings.aria.readout("Launch"));
    expect(readout?.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector(".meteo-sample-strip-svg")?.getAttribute("aria-label")).toBe(
      defaultStrings.aria.sampleStrip("Launch"),
    );
  });

  it("pins by timestamp so the rolling window keeps the same moment, then clears when it rolls out", () => {
    mockStripBounds();
    const samples = makeSamples();
    const lastAt = samples.points[11]?.observedAt as string;
    const { container, rerender } = render(
      <WindSampleStrip formatTime={isoTime} samples={samples} stationName="Launch" />,
    );
    const readout = () => container.querySelector(".meteo-sample-strip-readout");
    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(lastAt)));
    expect(readout()?.textContent).toContain(`21 ${defaultStrings.speedUnits.kmh}`);
    expect(readout()?.textContent).toContain("W 270°");

    /* The window slides one sample: the pinned moment survives by timestamp. */
    const slid: LiveSamples = {
      intervalSeconds: 3,
      points: [...samples.points.slice(1), sample(36, 22 / 3.6)],
    };
    rerender(<WindSampleStrip formatTime={isoTime} samples={slid} stationName="Launch" />);
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(lastAt)));

    /* The pinned sample rolls out entirely: back to the resting summary. */
    const rolled: LiveSamples = {
      intervalSeconds: 3,
      points: Array.from({ length: 12 }, (_, index) => sample(600 + index * 3, (10 + index) / 3.6)),
    };
    rerender(<WindSampleStrip formatTime={isoTime} samples={rolled} stationName="Launch" />);
    expect(readout()?.textContent).toContain(defaultStrings.inspectHint);
  });

  it("reads calm below the WMO threshold in the inspected sample", () => {
    mockStripBounds();
    const calmish = makeSamples((point) => ({
      ...point,
      windMps: 0.3,
      windDirectionDeg: null,
    }));
    const { container } = render(
      <WindSampleStrip formatTime={isoTime} samples={calmish} stationName="Launch" />,
    );
    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    expect(container.querySelector(".meteo-sample-strip-readout")?.textContent).toContain(
      defaultStrings.calm,
    );
  });

  it("honours an explicit plotHeight without forking the frame's row math", () => {
    const { container: standard } = render(
      <WindSampleStrip samples={makeSamples()} stationName="Launch" />,
    );
    expect(standard.querySelector(".meteo-sample-strip-svg")?.getAttribute("height")).toBe("150");

    const { container: tall } = render(
      <WindSampleStrip plotHeight={160} samples={makeSamples()} stationName="Launch" />,
    );
    expect(tall.querySelector(".meteo-sample-strip-svg")?.getAttribute("height")).toBe("234");
  });
});
