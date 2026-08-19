// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dial, Sparkline } from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import { downStation, makePoints, okStation } from "./fixtures.js";

describe("Dial", () => {
  it("draws the full instrument: face, ring, arc, ticks, cardinals, needle, hub, centred speed", () => {
    const { container } = render(<Dial station={okStation()} />);
    const svg = container.querySelector("svg.meteo-wind-dial");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(container.querySelector(".meteo-wind-dial-face")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-bezel")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-ring")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-arc")?.getAttribute("class")).toBe(
      "meteo-wind-dial-arc",
    );
    expect(container.querySelectorAll(".meteo-wind-dial-tick").length).toBe(16);
    expect(container.querySelectorAll(".meteo-wind-dial-tick-cardinal").length).toBe(4);
    expect(
      Array.from(container.querySelectorAll(".meteo-wind-dial-letter")).map(
        (letter) => letter.textContent,
      ),
    ).toEqual(["N", "E", "S", "W"]);
    expect(container.querySelector(".meteo-wind-needle-blade")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-needle-counterweight")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-hub")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("18");
    expect(container.querySelector(".meteo-wind-dial-unit")?.textContent).toBe("km/h");
    expect(svg?.getAttribute("aria-label")).toBe("Test Station: 18 km/h");
  });

  it("converts the centred speed to the display unit", () => {
    const { container } = render(<Dial station={okStation()} unit="knots" />);
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("10");
    expect(container.querySelector(".meteo-wind-dial-unit")?.textContent).toBe("kn");
  });

  it("draws no verdict ring without favorableDirections", () => {
    const { container } = render(<Dial station={okStation()} />);
    expect(container.querySelector(".meteo-wind-dial-ring-favorable")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-ring-unfavorable")).toBeNull();
  });

  it("rings favorable arcs over the unfavorable remainder at the bezel radius", () => {
    const { container } = render(
      <Dial favorableDirections={[{ fromDeg: 260, toDeg: 340 }]} station={okStation()} />,
    );
    expect(container.querySelector("circle.meteo-wind-dial-ring-unfavorable")).not.toBeNull();
    const arcs = container.querySelectorAll("path.meteo-wind-dial-ring-favorable");
    expect(arcs.length).toBe(1);
    expect(arcs[0]?.getAttribute("d")).toContain("A 70 70 0 0 1");
  });

  it("grades the speed arc into the reading's band when thresholds are given", () => {
    const { container } = render(
      <Dial station={okStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    expect(container.querySelector(".meteo-wind-dial-arc.meteo-band-1")).not.toBeNull();
  });

  it("hides the needle and centres the calm word while the measured speed stays in the hub", () => {
    const calm = okStation({
      reading: {
        ...okStation().reading,
        windAvgMps: 0.4 / 3.6,
        windGustMps: 1 / 3.6,
        windLullMps: 0,
        windDirectionDeg: 45,
      },
    });
    const { container } = render(<Dial station={calm} />);
    expect(container.querySelector(".meteo-wind-needle")).toBeNull();
    expect(container.querySelector(".meteo-wind-needle-blade")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-reason")?.textContent).toBe(
      defaultStrings.calm,
    );
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("0");
    expect(container.querySelector("svg.meteo-wind-dial")?.getAttribute("aria-label")).toBe(
      `Test Station: ${defaultStrings.calm}, 0 km/h`,
    );
  });

  it("withholds the hub calm word under calmWord={false}, for compositions whose direction row says it", () => {
    const calm = okStation({
      reading: {
        ...okStation().reading,
        windAvgMps: 0.4 / 3.6,
        windGustMps: 1 / 3.6,
        windLullMps: 0,
        windDirectionDeg: 45,
      },
    });
    const { container } = render(<Dial calmWord={false} station={calm} />);
    expect(container.querySelector(".meteo-wind-dial-reason")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("0");
    expect(container.querySelector("svg.meteo-wind-dial")?.getAttribute("aria-label")).toBe(
      `Test Station: ${defaultStrings.calm}, 0 km/h`,
    );
  });

  it("greys the dial and wears the reason in words when the station is unavailable", () => {
    const { container } = render(<Dial station={downStation()} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("meteo-wind-dial meteo-wind-dial-unavailable");
    expect(svg?.getAttribute("aria-label")).toBe(
      `Down Station: ${defaultStrings.reasons.upstream_error}`,
    );
    expect(container.querySelector(".meteo-wind-dial-reason")?.textContent).toBe(
      defaultStrings.notReporting,
    );
    expect(container.querySelector(".meteo-wind-dial-arc")).toBeNull();
    expect(container.querySelector(".meteo-wind-needle")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-speed")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-ring")).not.toBeNull();
  });

  it("scales the rendered box via size while the drawing geometry stays at 160", () => {
    const { container } = render(<Dial size={200} station={okStation()} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("200");
    expect(svg?.getAttribute("height")).toBe("200");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 160 160");
  });
});

describe("Sparkline", () => {
  it("draws one svg with the lull-gust band behind a single average polyline", () => {
    const { container } = render(<Sparkline station={okStation()} />);
    const svg = container.querySelector("svg.meteo-sparkline");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("width")).toBe("120");
    expect(svg?.getAttribute("height")).toBe("32");
    expect(container.querySelectorAll("polygon.meteo-sparkline-band").length).toBe(1);
    expect(container.querySelectorAll("polyline.meteo-sparkline-line").length).toBe(1);
    expect(container.querySelector(".meteo-sparkline-segment")).toBeNull();
  });

  it("withholds the band when showBand is false", () => {
    const { container } = render(<Sparkline showBand={false} station={okStation()} />);
    expect(container.querySelector(".meteo-sparkline-band")).toBeNull();
    expect(container.querySelector("polyline.meteo-sparkline-line")).not.toBeNull();
  });

  it("breaks the line and the band across dropouts beyond 2.5 declared periods", () => {
    const points = makePoints(12).filter((_, index) => index < 4 || index > 7);
    const station = okStation({ history: { periodMinutes: 5, points } });
    const { container } = render(<Sparkline station={station} />);
    expect(container.querySelectorAll("polyline.meteo-sparkline-line").length).toBe(2);
    expect(container.querySelectorAll("polygon.meteo-sparkline-band").length).toBe(2);
  });

  it("breaks the band where the gust-lull pair goes null while the line carries on", () => {
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point, index) =>
          index === 4 ? { ...point, windGustMps: null } : point,
        ),
      },
    });
    const { container } = render(<Sparkline station={station} />);
    expect(container.querySelectorAll("polygon.meteo-sparkline-band").length).toBe(2);
    expect(container.querySelectorAll("polyline.meteo-sparkline-line").length).toBe(1);
  });

  it("grades the trace per segment into wind bands when thresholds are given", () => {
    const { container } = render(
      <Sparkline station={okStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    expect(container.querySelectorAll("line.meteo-sparkline-segment").length).toBe(11);
    expect(container.querySelector(".meteo-sparkline-segment.meteo-band-0")).not.toBeNull();
    expect(container.querySelector(".meteo-sparkline-segment.meteo-band-2")).not.toBeNull();
    expect(container.querySelector("polyline.meteo-sparkline-line")).toBeNull();
    expect(container.querySelector("polygon.meteo-sparkline-band")).not.toBeNull();
  });

  it("renders an em-dash placeholder of the same fixed box for thin or absent history", () => {
    const thin = okStation({ history: { periodMinutes: 5, points: makePoints(1) } });
    const { container } = render(<Sparkline station={thin} />);
    expect(container.querySelector("svg")).toBeNull();
    const placeholder = container.querySelector("span.meteo-sparkline.meteo-sparkline-na");
    expect(placeholder?.textContent).toBe("—");
    expect((placeholder as HTMLElement).style.width).toBe("120px");
    expect((placeholder as HTMLElement).style.height).toBe("32px");

    const { container: down } = render(
      <Sparkline height={20} station={downStation()} width={80} />,
    );
    const downPlaceholder = down.querySelector("span.meteo-sparkline-na");
    expect(downPlaceholder?.textContent).toBe("—");
    expect((downPlaceholder as HTMLElement).style.width).toBe("80px");
    expect((downPlaceholder as HTMLElement).style.height).toBe("20px");
  });

  it("labels itself as six hours of wind at the station", () => {
    const { container } = render(<Sparkline station={okStation()} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "six hours of wind at Test Station",
    );
    const thin = okStation({ history: { periodMinutes: 5, points: makePoints(1) } });
    const { container: na } = render(<Sparkline station={thin} />);
    expect(na.querySelector(".meteo-sparkline-na")?.getAttribute("aria-label")).toBe(
      "six hours of wind at Test Station",
    );
  });

  it("keeps a dead-calm window on the floor with finite coordinates", () => {
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
    const { container } = render(<Sparkline station={station} />);
    const line = container.querySelector("polyline.meteo-sparkline-line");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("points")).not.toContain("NaN");
    const ys = (line?.getAttribute("points") ?? "")
      .split(" ")
      .map((pair) => Number(pair.split(",")[1]));
    expect(ys.every((y) => y === 31)).toBe(true);
  });
});
