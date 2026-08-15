// @vitest-environment node
import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AirMatrix,
  StationTable,
  StationFeedProvider,
  StationStrip,
  TrendChart,
  StationCard,
  useMeasuredChartWidth,
} from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import { BASE_MS, conditionsStation, downStation, feedFixture, okStation } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

describe("server rendering", () => {
  it("renderToString produces non-empty markup for the composite components", () => {
    const feed = feedFixture([okStation(), conditionsStation(), downStation()]);
    const html = renderToString(
      <div className="meteo-root">
        <StationCard
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          servedAt={feed.servedAt}
          station={okStation()}
          thresholds={{ unit: "kmh", values: [12, 20, 28] }}
          unit="knots"
        />
        <AirMatrix formatTime={isoTime} stations={feed.stations} />
        <StationTable
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          servedAt={feed.servedAt}
          stations={feed.stations}
        />
        <TrendChart formatTime={isoTime} series="temperature" station={okStation()} />
      </div>,
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Test Station");
    expect(html).toContain("meteo-air-trigger");
    expect(html).toContain("meteo-station-table");
    expect(html).toContain("meteo-trend");
  });

  it("renderToString handles a provider-fed page with propless components", () => {
    const feed = feedFixture([okStation(), conditionsStation(), downStation()]);
    const html = renderToString(
      <div className="meteo-root">
        <StationFeedProvider
          feed={feed}
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          thresholds={{ unit: "kmh", values: [12, 20, 28] }}
          unit="knots"
        >
          <StationCard />
          <StationTable />
          <StationStrip />
          <AirMatrix />
        </StationFeedProvider>
      </div>,
    );
    expect(html).toContain("Test Station");
    expect(html).toContain("meteo-wind-dial-arc meteo-band-1");
    expect(html).toContain("meteo-strip");
    expect(html).toContain("meteo-air-trigger");
    expect(html).toContain(defaultStrings.freshness.live);
  });

  it("renderToString handles a composed StationCard subset", () => {
    const feed = feedFixture([okStation()]);
    const html = renderToString(
      <StationCard
        formatTime={isoTime}
        receivedAtMs={BASE_MS + 30_000}
        servedAt={feed.servedAt}
        station={okStation()}
      >
        <StationCard.Chart />
        <StationCard.Summary />
      </StationCard>,
    );
    expect(html).toContain("meteo-summary");
    expect(html).not.toContain("meteo-wind-dial");
  });

  it("computes initial freshness from receivedAtMs, not the server's Date.now", () => {
    const feed = feedFixture([okStation()]);
    const html = renderToString(
      <StationTable
        formatTime={isoTime}
        receivedAtMs={BASE_MS + 30_000}
        servedAt={feed.servedAt}
        stations={feed.stations}
      />,
    );
    expect(html).toContain(defaultStrings.freshness.live);
    expect(html).not.toContain(defaultStrings.freshness.stale);
  });

  it("useMeasuredChartWidth holds (null) on the server without a layout-effect warning", () => {
    function MeasuredProbe() {
      const ref = useRef<HTMLDivElement | null>(null);
      const width = useMeasuredChartWidth(ref);
      return <div ref={ref}>{width === null ? "held" : String(width)}</div>;
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<MeasuredProbe />);
    expect(html).toContain("held");
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
