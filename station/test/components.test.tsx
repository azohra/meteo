// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AirMatrix,
  CurrentConditions,
  StationTable,
  StationFeedProvider,
  StationStrip,
  WindHistoryChart,
  WindRose,
  StationCard,
} from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import {
  conditionsFixture,
  conditionsStation,
  downStation,
  feedFixture,
  makePoints,
  okStation,
} from "./fixtures.js";

const NOW_MS = Date.now();

describe("CurrentConditions", () => {
  it("renders the ok arm: speed in the dial, direction, needle, speed arc", () => {
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={okStation()}
      />,
    );
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("18");
    expect(container.querySelector(".meteo-wind-needle")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-needle-blade")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-needle-counterweight")).not.toBeNull();
    const arc = container.querySelector(".meteo-wind-dial-arc");
    expect(arc).not.toBeNull();
    expect(arc?.getAttribute("class")).toBe("meteo-wind-dial-arc");
    expect(container.querySelector(".meteo-current-direction")?.textContent).toContain("NW");
    expect(container.querySelector(".meteo-current-direction")?.textContent).toContain("312°");
  });

  it("grades the speed arc by the current reading's band when thresholds are given", () => {
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={okStation()}
        thresholds={{ unit: "kmh", values: [12, 20] }}
      />,
    );
    expect(container.querySelector(".meteo-wind-dial-arc.meteo-band-1")).not.toBeNull();
  });

  it("renders calm in words with no needle and the measured speed still shown", () => {
    const station = okStation({
      reading: {
        ...okStation().reading,
        windAvgMps: 0,
        windDirectionDeg: null,
        windGustMps: 0,
        windLullMps: 0,
      },
    });
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={station}
      />,
    );
    expect(container.querySelector(".meteo-wind-needle")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial-arc")).toBeNull();
    expect(container.querySelector(".meteo-current-direction")?.textContent).toBe(
      defaultStrings.calm,
    );
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("0");
  });

  it("treats a sub-0.5 m/s reading as calm even when the vane reports a bearing", () => {
    const station = okStation({
      reading: { ...okStation().reading, windAvgMps: 1.2 / 3.6, windDirectionDeg: 90 },
    });
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={station}
      />,
    );
    expect(container.querySelector(".meteo-wind-needle")).toBeNull();
    expect(container.querySelector(".meteo-current-direction")?.textContent).toBe(
      defaultStrings.calm,
    );
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("1");
  });

  it("dashes the direction for a blowing reading with a dead vane", () => {
    const station = okStation({
      reading: { ...okStation().reading, windAvgMps: 10 / 3.6, windDirectionDeg: null },
    });
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={station}
      />,
    );
    expect(container.querySelector(".meteo-wind-needle")).toBeNull();
    expect(container.querySelector(".meteo-current-direction")?.textContent).toBe("—");
  });

  it("renders the unavailable arm: greyed dial and reason words", () => {
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={downStation()}
      />,
    );
    expect(container.querySelector(".meteo-wind-dial-unavailable")).not.toBeNull();
    expect(container.querySelector(".meteo-current-direction")?.textContent).toBe(
      defaultStrings.reasons.upstream_error,
    );
  });

  it("omits the temperature row without the capability, dashes a dark sensor", () => {
    const noThermometer = okStation({
      capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
    });
    const { container: without } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={noThermometer}
      />,
    );
    expect(without.querySelector(".meteo-current-temp")).toBeNull();

    const darkSensor = okStation({
      reading: { ...okStation().reading, temperatureC: null, windChillC: null },
    });
    const { container: dashed } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={darkSensor}
      />,
    );
    expect(dashed.querySelector(".meteo-current-temp")?.textContent).toBe("—");
  });

  it("rounds the dial scale up to a nice step in the DISPLAY unit", () => {
    const strong = okStation({
      reading: { ...okStation().reading, windAvgMps: 40 / 3.6, windGustMps: 50 / 3.6 },
    });
    const { container: knots } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={strong}
        unit="knots"
      />,
    );
    expect(knots.querySelector(".meteo-wind-dial-arc")?.getAttribute("d")).toBe(
      "M 80.0 10.0 A 70 70 0 1 1 11.2 93.1",
    );
    const { container: kmh } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={strong}
        unit="kmh"
      />,
    );
    expect(kmh.querySelector(".meteo-wind-dial-arc")?.getAttribute("d")).toBe(
      "M 80.0 10.0 A 70 70 0 1 1 13.4 58.4",
    );
  });

  it("scales freshness to the station's cadence, not the flat default", () => {
    const { container } = render(
      <CurrentConditions
        receivedAtMs={NOW_MS - 8 * 60_000}
        servedAt={feedFixture().servedAt}
        station={okStation()}
      />,
    );
    expect(container.querySelector(".meteo-freshness")?.textContent).toBe(
      defaultStrings.freshness.aging,
    );
  });
});

describe("WindRose", () => {
  it("draws no judgment ring without favorableDirections", () => {
    const { container } = render(<WindRose points={makePoints(12)} />);
    expect(container.querySelector(".meteo-wind-rose-ring-favorable")).toBeNull();
    expect(container.querySelector(".meteo-wind-rose-ring-unfavorable")).toBeNull();
  });

  it("rings favorable sectors over an unfavorable remainder and speaks them", () => {
    const { container } = render(
      <WindRose favorableDirections={[{ fromDeg: 260, toDeg: 340 }]} points={makePoints(12)} />,
    );
    expect(container.querySelector("circle.meteo-wind-rose-ring-unfavorable")).not.toBeNull();
    const arcs = container.querySelectorAll("path.meteo-wind-rose-ring-favorable");
    expect(arcs.length).toBe(1);
    expect(arcs[0]?.getAttribute("d")).toContain("A 75 75 0 0 1");
    expect(container.querySelector(".meteo-wind-rose-petal[class*='meteo-band-']")).toBeNull();
    expect(container.querySelector(".meteo-wind-rose-svg")?.getAttribute("aria-label")).toContain(
      defaultStrings.aria.roseFavorable("260°–340°"),
    );
  });

  it("wraps a favorable sector through north and flags spans past 180°", () => {
    const { container } = render(
      <WindRose
        favorableDirections={[
          { fromDeg: 300, toDeg: 40 },
          { fromDeg: 90, toDeg: 350 },
        ]}
        points={makePoints(12)}
      />,
    );
    const flags = Array.from(container.querySelectorAll("path.meteo-wind-rose-ring-favorable")).map(
      (arc) => arc.getAttribute("d")?.match(/A 75 75 0 (\d) 1/)?.[1],
    );
    expect(flags).toEqual(["0", "1"]);
    expect(container.querySelector(".meteo-wind-rose-svg")?.getAttribute("aria-label")).toContain(
      defaultStrings.aria.roseFavorable("300°–40°, 90°–350°"),
    );
  });

  it("draws petals, grades them with thresholds, and captions the calm share", () => {
    const points = makePoints(12, (point, index) =>
      index < 6
        ? { ...point, windAvgMps: 0, windGustMps: 0, windLullMps: 0, windDirectionDeg: null }
        : point,
    );
    const { container } = render(
      <WindRose points={points} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    const petals = container.querySelectorAll(".meteo-wind-rose-petal");
    expect(petals.length).toBeGreaterThan(0);
    expect(container.querySelector(".meteo-wind-rose-petal[class*='meteo-band-']")).not.toBeNull();
    const calm = container.querySelector(".meteo-wind-rose-calm");
    expect(calm?.tagName).toBe("P");
    expect(calm?.textContent).toBe(defaultStrings.percentCalm(50));
    expect(container.querySelector(".meteo-wind-rose-ring-label")?.textContent).toMatch(/^\d+%$/);
  });
});

describe("StationTable", () => {
  it("keeps one row per station, dashes nulls, and spells out outages", () => {
    const gustless = okStation({
      reading: { ...okStation().reading, windGustMps: null, windLullMps: null },
    });
    const feed = feedFixture([gustless, downStation()]);
    const { container } = render(
      <StationTable receivedAtMs={NOW_MS} servedAt={feed.servedAt} stations={feed.stations} />,
    );
    expect(container.querySelectorAll("[role='row']").length).toBe(3);
    expect(container.querySelector(".meteo-station-table-gust")?.textContent).toBe("—");
    expect(container.querySelector(".meteo-station-table-reason")?.textContent).toBe(
      defaultStrings.reasons.upstream_error,
    );
    expect(container.querySelector(".meteo-station-table-temp")?.textContent).toContain("14.2");
  });

  it("says calm below the WMO threshold and keeps the dash for a dead vane", () => {
    const calmish = okStation({
      reading: { ...okStation().reading, windAvgMps: 1.5 / 3.6, windDirectionDeg: 200 },
    });
    const vaneless = okStation({
      id: "vaneless",
      reading: { ...okStation().reading, windAvgMps: 12 / 3.6, windDirectionDeg: null },
    });
    const feed = feedFixture([calmish, vaneless]);
    const { container } = render(
      <StationTable receivedAtMs={NOW_MS} servedAt={feed.servedAt} stations={feed.stations} />,
    );
    const cells = container.querySelectorAll(".meteo-station-table-from");
    expect(cells[0]?.textContent).toBe(defaultStrings.calm);
    expect(cells[1]?.textContent).toBe("—");
  });

  it("converts displayed speeds to knots while thresholds stay wire-unit", () => {
    const feed = feedFixture([okStation()]);
    const { container } = render(
      <StationTable
        receivedAtMs={NOW_MS}
        servedAt={feed.servedAt}
        stations={feed.stations}
        unit="knots"
      />,
    );
    expect(container.querySelector(".meteo-station-table-wind strong")?.textContent).toBe("10");
    expect(container.querySelector(".meteo-station-table-wind small")?.textContent).toBe("kn");
    expect(container.querySelector(".meteo-station-table-gust")?.textContent).toBe("13");
    expect(container.querySelector(".meteo-station-table-lull")?.textContent).toBe("6");
  });

  it("scales row freshness to each station's cadence", () => {
    const feed = feedFixture([okStation()]);
    const { container } = render(
      <StationTable
        receivedAtMs={NOW_MS - 8 * 60_000}
        servedAt={feed.servedAt}
        stations={feed.stations}
      />,
    );
    expect(container.querySelector(".meteo-freshness")?.textContent).toBe(
      defaultStrings.freshness.aging,
    );
  });

  it("lets stationMeta replace the source sub-label per station", () => {
    const feed = feedFixture([okStation(), downStation()]);
    const { container } = render(
      <StationTable
        receivedAtMs={NOW_MS}
        servedAt={feed.servedAt}
        stationMeta={(station) =>
          station.status === "ok" && station.samplingWindowSeconds != null
            ? `past ${station.samplingWindowSeconds} s`
            : station.sourceLabel
        }
        stations={feed.stations}
      />,
    );
    const subLabels = container.querySelectorAll(".meteo-station-table-station small");
    expect(subLabels[0]?.textContent).toBe(`past ${okStation().samplingWindowSeconds} s`);
    expect(subLabels[1]?.textContent).toBe(downStation().sourceLabel);
  });
});

describe("StationStrip", () => {
  it("renders one line via explicit props: linked name, wind, lull/gust, FROM, temp, updated", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationStrip receivedAtMs={NOW_MS} servedAt={feed.servedAt} station={okStation()} />,
    );
    const strip = container.querySelector(".meteo-strip");
    expect(strip?.getAttribute("role")).toBe("group");
    expect(strip?.getAttribute("aria-label")).toBe(defaultStrings.aria.strip("Test Station"));
    expect(container.querySelector(".meteo-strip-station a")?.getAttribute("href")).toBe(
      "https://example.com/stations/test",
    );
    expect(container.querySelector(".meteo-strip-wind strong")?.textContent).toBe("18");
    expect(container.querySelector(".meteo-strip-wind small")?.textContent).toBe("km/h");
    expect(container.querySelector(".meteo-strip-lull")?.textContent).toContain("11");
    expect(container.querySelector(".meteo-strip-gust")?.textContent).toContain("24");
    expect(container.querySelector(".meteo-strip-from")?.textContent).toContain("NW");
    expect(container.querySelector(".meteo-strip-from")?.textContent).toContain("312°");
    expect(container.querySelector(".meteo-strip-temp")?.textContent).toContain("14.2");
    expect(container.querySelector(".meteo-strip-time")).not.toBeNull();
    expect(container.querySelector(".meteo-freshness")).not.toBeNull();
  });

  it("dashes absent values in place but omits cells for missing capabilities", () => {
    const dark = okStation({
      reading: { ...okStation().reading, windGustMps: null, windLullMps: null, temperatureC: null },
    });
    const { container: dashed } = render(
      <StationStrip receivedAtMs={NOW_MS} servedAt={feedFixture().servedAt} station={dark} />,
    );
    expect(dashed.querySelector(".meteo-strip-lull")?.textContent).toContain("—");
    expect(dashed.querySelector(".meteo-strip-gust")?.textContent).toContain("—");
    expect(dashed.querySelector(".meteo-strip-temp")?.textContent).toBe("—");

    const bare = okStation({
      capabilities: { gustLull: false, temperature: false, conditions: false, history: true },
    });
    const { container: omitted } = render(
      <StationStrip receivedAtMs={NOW_MS} servedAt={feedFixture().servedAt} station={bare} />,
    );
    expect(omitted.querySelector(".meteo-strip-lull")).toBeNull();
    expect(omitted.querySelector(".meteo-strip-gust")).toBeNull();
    expect(omitted.querySelector(".meteo-strip-temp")).toBeNull();
    expect(omitted.querySelector(".meteo-strip-wind")).not.toBeNull();
  });

  it("says calm below the WMO threshold and keeps the dash for a dead vane", () => {
    const calmish = okStation({
      reading: { ...okStation().reading, windAvgMps: 1.5 / 3.6, windDirectionDeg: 200 },
    });
    const { container: calm } = render(
      <StationStrip receivedAtMs={NOW_MS} servedAt={feedFixture().servedAt} station={calmish} />,
    );
    expect(calm.querySelector(".meteo-strip-from")?.textContent).toBe(defaultStrings.calm);

    const vaneless = okStation({
      reading: { ...okStation().reading, windAvgMps: 12 / 3.6, windDirectionDeg: null },
    });
    const { container: dead } = render(
      <StationStrip receivedAtMs={NOW_MS} servedAt={feedFixture().servedAt} station={vaneless} />,
    );
    expect(dead.querySelector(".meteo-strip-from")?.textContent).toBe("—");
  });

  it("renders the unavailable arm: name held, reason words in place of the cells", () => {
    const { container } = render(
      <StationStrip
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={downStation()}
      />,
    );
    expect(container.querySelector(".meteo-strip")?.getAttribute("data-status")).toBe(
      "unavailable",
    );
    expect(container.querySelector(".meteo-strip-station")?.textContent).toBe("Down Station");
    expect(container.querySelector(".meteo-strip-reason")?.textContent).toBe(
      defaultStrings.reasons.upstream_error,
    );
    expect(container.querySelector(".meteo-strip-wind")).toBeNull();
    expect(container.querySelector(".meteo-strip-updated")).toBeNull();
  });

  it("converts displayed speeds to knots while the wire stays m/s", () => {
    const { container } = render(
      <StationStrip
        receivedAtMs={NOW_MS}
        servedAt={feedFixture().servedAt}
        station={okStation()}
        unit="knots"
      />,
    );
    expect(container.querySelector(".meteo-strip-wind strong")?.textContent).toBe("10");
    expect(container.querySelector(".meteo-strip-wind small")?.textContent).toBe("kn");
    expect(container.querySelector(".meteo-strip-lull")?.textContent).toContain("6");
    expect(container.querySelector(".meteo-strip-gust")?.textContent).toContain("13");
  });

  it("resolves its station from the provider: primary propless, stationId by lookup", () => {
    const provided = (ui: ReactNode) =>
      render(
        <StationFeedProvider feed={feedFixture()} receivedAtMs={NOW_MS} unit="knots">
          {ui}
        </StationFeedProvider>,
      );
    const { container: primary } = provided(<StationStrip />);
    expect(primary.querySelector(".meteo-strip-station")?.textContent).toBe("Test Station");
    expect(primary.querySelector(".meteo-strip-wind strong")?.textContent).toBe("10");
    expect(primary.querySelector(".meteo-freshness")).not.toBeNull();

    const { container: byId } = provided(<StationStrip stationId="down-station" />);
    expect(byId.querySelector(".meteo-strip")?.getAttribute("data-status")).toBe("unavailable");
  });

  it("throws a wiring error when nothing resolves a station", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<StationStrip />)).toThrow(/<StationStrip> resolved no station/);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("AirMatrix", () => {
  const isoTime = (date: Date) => date.toISOString();

  it("renders nothing when no station declares the conditions capability", () => {
    const { container } = render(<AirMatrix stations={[okStation(), downStation()]} />);
    expect(container.firstChild).toBeNull();
  });

  it("gates columns by capability and carries a live summary on the folded trigger", () => {
    const { container } = render(
      <AirMatrix stations={feedFixture([okStation(), conditionsStation()]).stations} />,
    );
    const headers = container.querySelectorAll("[role='columnheader']");
    expect(headers.length).toBe(2);
    expect(headers[1]?.textContent).toBe("Conditions Station");

    const trigger = container.querySelector(".meteo-air-trigger");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    const summary = container.querySelector(".meteo-air-summary")?.textContent ?? "";
    expect(summary).toContain(defaultStrings.air.summaryHumidity(64));
    expect(summary).toContain(defaultStrings.air.summaryRainToday(1.6));
    expect(summary).toContain(defaultStrings.air.summaryStrikes(2));
  });

  it("expands to the matrix: reported rows only, null cells em-dashed, strike sentence below", () => {
    const dark = conditionsStation({
      id: "dark-tempest",
      name: "Dark Tempest",
    });
    const darkReading = {
      ...dark.reading,
      windChillC: null,
      conditions: conditionsFixture({
        relativeHumidityPercent: null,
        solarRadiationWm2: null,
        uvIndex: null,
      }),
    };
    const stations = [conditionsStation(), { ...dark, reading: darkReading }];
    const { container } = render(<AirMatrix formatTime={isoTime} stations={stations} />);
    fireEvent.click(container.querySelector(".meteo-air-trigger") as HTMLButtonElement);
    expect(container.querySelector(".meteo-air-trigger")?.getAttribute("aria-expanded")).toBe(
      "true",
    );

    const rows = Array.from(container.querySelectorAll(".meteo-air-row:not(.meteo-air-head)"));
    const labelOf = (row: Element) =>
      row.querySelector(".meteo-air-label")?.childNodes[0]?.textContent;
    expect(rows.map(labelOf)).toContain(defaultStrings.air.uv);
    expect(rows.map(labelOf)).toContain(defaultStrings.air.feelsLike);
    const uvRow = rows.find((row) => labelOf(row) === defaultStrings.air.uv);
    const uvCells = uvRow?.querySelectorAll("[role='cell']");
    expect(uvCells?.[0]?.textContent).toBe("6.1");
    expect(uvCells?.[1]?.textContent).toBe("—");

    const trendRow = rows.find((row) => labelOf(row) === defaultStrings.air.pressureTrend);
    expect(trendRow?.querySelector("[role='cell']")?.textContent).toBe(
      defaultStrings.air.trendFalling,
    );

    const note = container.querySelector(".meteo-air-note")?.textContent ?? "";
    expect(note).toBe(
      defaultStrings.air.lastStrike(
        19,
        isoTime(new Date(conditionsFixture().lastLightningStrikeAt as string)),
      ),
    );
  });

  it("keeps a capable station's column when its reading is dark, all cells dashed", () => {
    const offline = {
      ...downStation(),
      capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
    };
    const { container } = render(<AirMatrix stations={[conditionsStation(), offline]} />);
    fireEvent.click(container.querySelector(".meteo-air-trigger") as HTMLButtonElement);
    const rows = container.querySelectorAll(".meteo-air-row:not(.meteo-air-head)");
    for (const row of Array.from(rows)) {
      const cells = row.querySelectorAll("[role='cell']");
      expect(cells.length).toBe(2);
      expect(cells[1]?.textContent).toBe("—");
    }
  });
});

describe("StationCard", () => {
  it("childless composes header, instrument, chart, and summary strip", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationCard receivedAtMs={NOW_MS} servedAt={feed.servedAt} station={okStation()} />,
    );
    expect(container.querySelector(".meteo-station-card-name")?.textContent).toContain(
      "Test Station",
    );
    expect(container.querySelector(".meteo-wind-dial")).not.toBeNull();
    expect(container.querySelector(".meteo-summary")).not.toBeNull();
    const summaryText = container.querySelector(".meteo-summary")?.textContent ?? "";
    expect(summaryText).toContain(defaultStrings.windRunLabel);
  });

  it("threads thresholds through to the dial's speed arc", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationCard
        receivedAtMs={NOW_MS}
        servedAt={feed.servedAt}
        station={okStation()}
        thresholds={{ unit: "kmh", values: [12, 20] }}
      />,
    );
    expect(container.querySelector(".meteo-wind-dial-arc.meteo-band-1")).not.toBeNull();
  });

  it("with children renders only the asked-for pieces, context-fed", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationCard receivedAtMs={NOW_MS} servedAt={feed.servedAt} station={okStation()}>
        <StationCard.Chart />
        <StationCard.Summary />
      </StationCard>,
    );
    expect(container.querySelector(".meteo-station-card-name")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial")).toBeNull();
    expect(container.querySelector(".meteo-wind-chart")).not.toBeNull();
    expect(container.querySelector(".meteo-summary")).not.toBeNull();
    expect(container.querySelector(".meteo-station-card")?.getAttribute("data-status")).toBe("ok");
  });

  it("lets a subcomponent's explicit props override the provider's context", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationCard receivedAtMs={NOW_MS} servedAt={feed.servedAt} station={okStation()}>
        <StationCard.Chart thresholds={{ unit: "kmh", values: [12, 20] }} />
      </StationCard>,
    );
    expect(container.querySelector(".meteo-wind-mean-segment.meteo-band-0")).not.toBeNull();
  });

  it("throws a clear error when a subcomponent renders outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<StationCard.Summary />)).toThrow(
        /<StationCard\.Summary> must render inside <StationCard>/,
      );
    } finally {
      quiet.mockRestore();
    }
  });

  it("treats authored-but-false children as composition mode, not as childless", () => {
    const feed = feedFixture();
    const cond = false as boolean;
    const { container } = render(
      <StationCard receivedAtMs={NOW_MS} servedAt={feed.servedAt} station={okStation()}>
        {cond && <StationCard.Header />}
      </StationCard>,
    );
    expect(container.querySelector(".meteo-station-card")).not.toBeNull();
    expect(container.querySelector(".meteo-station-card-name")).toBeNull();
    expect(container.querySelector(".meteo-wind-dial")).toBeNull();
    expect(container.querySelector(".meteo-summary")).toBeNull();
  });
});

describe("StationFeedProvider", () => {
  const provided = (ui: ReactNode, feed = feedFixture()) =>
    render(
      <StationFeedProvider
        feed={feed}
        receivedAtMs={NOW_MS}
        thresholds={{ unit: "kmh", values: [12, 20] }}
        unit="knots"
      >
        {ui}
      </StationFeedProvider>,
    );

  it("supplies station, clocks, unit, and thresholds so components render propless", () => {
    const { container } = provided(<CurrentConditions />);
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("10");
    expect(container.querySelector(".meteo-wind-dial-unit")?.textContent).toBe("kn");
    expect(container.querySelector(".meteo-wind-dial-arc.meteo-band-1")).not.toBeNull();
    expect(container.querySelector(".meteo-freshness")).not.toBeNull();
  });

  it("resolves per-station components by stationId, then primaryStationId, then stations[0]", () => {
    const { container: byId } = provided(<CurrentConditions stationId="down-station" />);
    expect(byId.querySelector(".meteo-current")?.getAttribute("data-status")).toBe("unavailable");

    const noPrimary = { ...feedFixture(), primaryStationId: null };
    const { container: first } = provided(<CurrentConditions />, noPrimary);
    expect(first.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("10");
  });

  it("lets explicit props override the provider, and null thresholds opt out", () => {
    const { container } = provided(<CurrentConditions thresholds={null} unit="kmh" />);
    expect(container.querySelector(".meteo-wind-dial-speed")?.textContent).toBe("18");
    const arc = container.querySelector(".meteo-wind-dial-arc");
    expect(arc?.getAttribute("class")).toBe("meteo-wind-dial-arc");
  });

  it("feeds the fleet components their stations", () => {
    const feed = feedFixture([okStation(), conditionsStation(), downStation()]);
    const { container } = provided(
      <>
        <StationTable />
        <AirMatrix />
      </>,
      feed,
    );
    expect(container.querySelectorAll(".meteo-station-table [role='row']").length).toBe(4);
    expect(container.querySelector(".meteo-air-trigger")).not.toBeNull();
  });

  it("threads defaults through a propless StationCard card", () => {
    const { container } = provided(<StationCard />);
    expect(container.querySelector(".meteo-station-card-name")?.textContent).toContain(
      "Test Station",
    );
    expect(container.querySelector(".meteo-wind-dial-arc.meteo-band-1")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-dial-unit")?.textContent).toBe("kn");
  });

  it("merges strings layer by layer instead of replacing", () => {
    const feed = feedFixture();
    const { container } = render(
      <StationFeedProvider
        feed={feed}
        receivedAtMs={NOW_MS}
        strings={{ freshness: { live: "Fresh" }, gustLabel: "boost" }}
      >
        <CurrentConditions strings={{ gustLabel: "puff" }} />
      </StationFeedProvider>,
    );
    expect(
      container.querySelector(".meteo-current-flank-gust .meteo-microlabel")?.textContent,
    ).toBe("puff");
    expect(container.querySelector(".meteo-freshness")?.textContent).toBe("Fresh");
  });

  it("throws a wiring error when nothing resolves a station", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<CurrentConditions />)).toThrow(
        /<CurrentConditions> resolved no station/,
      );
      expect(() => render(<StationTable />)).toThrow(/<StationTable> resolved no stations/);
    } finally {
      quiet.mockRestore();
    }
  });

  it("components inside a provider still honour a fully explicit-props usage", () => {
    const { container } = provided(
      <WindHistoryChart
        station={okStation()}
        thresholds={{ unit: "kmh", values: [12, 20] }}
        unit="kmh"
      />,
    );
    expect(container.querySelector(".meteo-wind-threshold-label.meteo-band-2")?.textContent).toBe(
      "20",
    );
  });
});
