// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BandChip,
  Direction,
  Gust,
  Lull,
  Pressure,
  Speed,
  StationFeedProvider,
  Temperature,
  UpdatedAt,
} from "../src/react/index.js";
import { defaultStrings } from "../src/index.js";
import {
  BASE_MS,
  conditionsStation,
  downStation,
  feedFixture,
  iso,
  okStation,
} from "./fixtures.js";

const EM_DASH = "—";
const RECEIVED_MS = BASE_MS + 30_000;

const calmStation = () =>
  okStation({
    reading: {
      ...okStation().reading,
      windAvgMps: 0.2,
      windDirectionDeg: 90,
      windGustMps: 0.4,
      windLullMps: 0,
    },
  });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Speed / Gust / Lull", () => {
  it("renders the converted integer with the unit word and the wire m/s on the value attribute", () => {
    const { container } = render(<Speed station={okStation()} />);
    const data = container.querySelector("data.meteo-value.meteo-speed");
    expect(data?.textContent).toBe("18 km/h");
    expect(data?.querySelector(".meteo-unit")?.textContent).toBe("km/h");
    expect(data?.getAttribute("value")).toBe(String(18.4 / 3.6));
  });

  it("converts to knots for display", () => {
    const { container } = render(<Speed station={okStation()} unit="knots" />);
    expect(container.querySelector("data")?.textContent).toBe("10 kn");
  });

  it("resolves the station from the provider: primary by default, stationId when given", () => {
    const { container } = render(
      <StationFeedProvider feed={feedFixture()} receivedAtMs={RECEIVED_MS}>
        <Speed />
        <Speed stationId="down-station" />
      </StationFeedProvider>,
    );
    const values = container.querySelectorAll("data.meteo-speed");
    expect(values[0]?.textContent).toBe("18 km/h");
    expect(values[1]?.textContent).toBe(EM_DASH);
    expect(values[1]?.hasAttribute("value")).toBe(false);
  });

  it("throws the wiring error when no station resolves anywhere", () => {
    expect(() => render(<Speed />)).toThrow(/resolved no station/);
  });

  it("renders gust and lull, dashing a null value in place", () => {
    const { container: full } = render(
      <>
        <Gust station={okStation()} />
        <Lull station={okStation()} />
      </>,
    );
    const cells = full.querySelectorAll("data.meteo-speed");
    expect(cells[0]?.textContent).toBe("24 km/h");
    expect(cells[1]?.textContent).toBe("11 km/h");

    const deadGust = okStation({ reading: { ...okStation().reading, windGustMps: null } });
    const { container } = render(<Gust station={deadGust} />);
    expect(container.querySelector("data")?.textContent).toBe(EM_DASH);
  });

  it("dashes gust and lull for a station without the gustLull capability", () => {
    const noGusts = okStation({
      capabilities: { gustLull: false, temperature: true, conditions: false, history: true },
    });
    const { container } = render(
      <>
        <Gust station={noGusts} />
        <Lull station={noGusts} />
      </>,
    );
    for (const cell of container.querySelectorAll("data.meteo-speed")) {
      expect(cell.textContent).toBe(EM_DASH);
    }
  });
});

describe("Temperature / Pressure", () => {
  it("prints one decimal with the degree word; dark sensor and lacking capability dash", () => {
    const { container } = render(<Temperature station={okStation()} />);
    expect(container.querySelector("data.meteo-temperature")?.textContent).toBe("14.2 °C");

    const dark = okStation({ reading: { ...okStation().reading, temperatureC: null } });
    const { container: dashed } = render(<Temperature station={dark} />);
    expect(dashed.querySelector("data")?.textContent).toBe(EM_DASH);

    const noThermometer = okStation({
      capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
    });
    const { container: without } = render(<Temperature station={noThermometer} />);
    expect(without.querySelector("data")?.textContent).toBe(EM_DASH);
  });

  it("prints sea-level pressure to one decimal hPa; a conditions-less station dashes", () => {
    const { container } = render(<Pressure station={conditionsStation()} />);
    expect(container.querySelector("data.meteo-pressure")?.textContent).toBe("1012.6 hPa");

    const { container: dashed } = render(<Pressure station={okStation()} />);
    expect(dashed.querySelector("data")?.textContent).toBe(EM_DASH);
  });
});

describe("Direction", () => {
  it("renders the arrow glyph, compass word, and rounded degrees, spelled out for aria", () => {
    const { container } = render(<Direction station={okStation()} />);
    const direction = container.querySelector("span.meteo-direction");
    expect(direction?.textContent).toContain("NW");
    expect(direction?.textContent).toContain("312°");
    expect(direction?.querySelector("svg.meteo-wind-arrow")).not.toBeNull();
    expect(direction?.getAttribute("aria-label")).toBe("from northwest, 312 degrees");
  });

  it("says calm in a word even when the vane reports a parked bearing, and never draws an arrow", () => {
    const { container } = render(<Direction station={calmStation()} />);
    const direction = container.querySelector(".meteo-direction");
    expect(direction?.textContent).toBe(defaultStrings.calm);
    expect(direction?.hasAttribute("aria-label")).toBe(false);
    expect(container.querySelector(".meteo-wind-arrow")).toBeNull();
  });

  it("routes the spoken words through strings: compassSpoken and aria.direction override", () => {
    const { container } = render(
      <Direction
        station={okStation()}
        strings={{
          compassSpoken: { NW: "nordwest" },
          aria: { direction: (spoken, deg) => `aus ${spoken}, ${deg} Grad` },
        }}
      />,
    );
    expect(container.querySelector(".meteo-direction")?.getAttribute("aria-label")).toBe(
      "aus nordwest, 312 Grad",
    );
  });

  it("wears the verdict class and speaks it only when arcs judge the bearing", () => {
    /* okStation reads from 312°; the first arc holds it, the second does not. */
    const favorable = render(
      <Direction favorableDirections={[{ fromDeg: 260, toDeg: 340 }]} station={okStation()} />,
    );
    const good = favorable.container.querySelector(".meteo-direction");
    expect(good?.getAttribute("class")).toBe("meteo-direction meteo-direction-favorable");
    expect(good?.getAttribute("aria-label")).toContain(defaultStrings.aria.favorable);

    const unfavorable = render(
      <Direction favorableDirections={[{ fromDeg: 80, toDeg: 120 }]} station={okStation()} />,
    );
    expect(unfavorable.container.querySelector(".meteo-direction")?.getAttribute("class")).toBe(
      "meteo-direction meteo-direction-unfavorable",
    );

    /* Calm never wears a verdict — there is no direction to judge. */
    const calm = render(
      <Direction favorableDirections={[{ fromDeg: 260, toDeg: 340 }]} station={calmStation()} />,
    );
    expect(calm.container.querySelector(".meteo-direction")?.getAttribute("class")).toBe(
      "meteo-direction",
    );
  });

  it("dashes a blowing reading with a dead vane and an unavailable station alike", () => {
    const deadVane = okStation({ reading: { ...okStation().reading, windDirectionDeg: null } });
    const { container } = render(
      <>
        <Direction station={deadVane} />
        <Direction station={downStation()} />
      </>,
    );
    for (const cell of container.querySelectorAll(".meteo-direction")) {
      expect(cell.textContent).toBe(EM_DASH);
    }
  });
});

describe("UpdatedAt", () => {
  it("says 'just now' fresh off the poll and ticks to relative minutes on the 30 s clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RECEIVED_MS));
    const { container } = render(
      <UpdatedAt receivedAtMs={RECEIVED_MS} servedAt={iso(RECEIVED_MS)} station={okStation()} />,
    );
    const time = container.querySelector("time.meteo-updated");
    expect(time?.getAttribute("datetime")).toBe(iso(BASE_MS));
    expect(time?.textContent).toBe("just now");
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(container.querySelector("time.meteo-updated")?.textContent).toBe("3 min ago");
  });

  it("ticks in the overridden `updated` vocabulary, keys merging per key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RECEIVED_MS));
    const { container } = render(
      <UpdatedAt
        receivedAtMs={RECEIVED_MS}
        servedAt={iso(RECEIVED_MS)}
        station={okStation()}
        strings={{ updated: { justNow: "gerade eben", minutesAgo: (n) => `vor ${n} min` } }}
      />,
    );
    expect(container.querySelector("time.meteo-updated")?.textContent).toBe("gerade eben");
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(container.querySelector("time.meteo-updated")?.textContent).toBe("vor 3 min");
  });

  it("falls back to the absolute formatTime words past ~6 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_MS));
    const old = okStation({
      reading: { ...okStation().reading, observedAt: iso(BASE_MS - 7 * 3_600_000) },
    });
    const { container } = render(
      <UpdatedAt
        formatTime={() => "11:00 AM"}
        receivedAtMs={BASE_MS}
        servedAt={iso(BASE_MS)}
        station={old}
      />,
    );
    expect(container.querySelector("time.meteo-updated")?.textContent).toBe("11:00 AM");
  });

  it("dashes an unavailable station instead of fabricating an age", () => {
    const { container } = render(
      <UpdatedAt receivedAtMs={RECEIVED_MS} servedAt={iso(RECEIVED_MS)} station={downStation()} />,
    );
    expect(container.querySelector(".meteo-updated")?.textContent).toBe(EM_DASH);
    expect(container.querySelector("time")).toBeNull();
  });
});

describe("BandChip", () => {
  it("grades the reading and wears the consumer's label with the band on data-band", () => {
    const { container } = render(
      <BandChip
        labels={["light", "fair", "strong"]}
        station={okStation()}
        thresholds={{ unit: "kmh", values: [12, 20] }}
      />,
    );
    const chip = container.querySelector("span.meteo-band-chip");
    expect(chip?.getAttribute("data-band")).toBe("1");
    expect(chip?.textContent).toBe("fair");
  });

  it("states the converted speed when no labels are given, thresholds ambient from the provider", () => {
    const { container } = render(
      <StationFeedProvider
        feed={feedFixture([okStation()])}
        receivedAtMs={RECEIVED_MS}
        thresholds={{ unit: "kmh", values: [12, 20, 28] }}
        unit="knots"
      >
        <BandChip />
      </StationFeedProvider>,
    );
    const chip = container.querySelector(".meteo-band-chip");
    expect(chip?.getAttribute("data-band")).toBe("1");
    expect(chip?.textContent).toBe("10 kn");
  });

  it("says calm in a word, ungraded — a band would judge air that is not moving", () => {
    const { container } = render(
      <BandChip station={calmStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    const chip = container.querySelector(".meteo-band-chip");
    expect(chip?.textContent).toBe(defaultStrings.calm);
    expect(chip?.hasAttribute("data-band")).toBe(false);
  });

  it("wears the em dash with no data-band for unavailable and ungraded readings", () => {
    const { container } = render(
      <>
        <BandChip station={downStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />
        <BandChip station={okStation()} />
      </>,
    );
    const chips = container.querySelectorAll(".meteo-band-chip");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.textContent).toBe(EM_DASH);
      expect(chip.hasAttribute("data-band")).toBe(false);
    }
  });
});
