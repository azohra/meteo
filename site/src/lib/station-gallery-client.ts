/* The station exhibits' client wiring, shared by the product page
   (/station/, the trimmed set of exhibits) and the docs catalogue
   (/docs/station/component-gallery/, every section). Each block guards on
   its exhibit's presence, so either page wires exactly what it renders.

   The order is the one a hermetic page needs: set every data property
   FIRST (the lazy-upgrade pattern captures assignments made before
   definition), then define the tags — so no element ever upgrades against
   an empty feed and throws. Republishing every few seconds keeps the
   freshness badges tracking the clock without a poll loop — the fixture is
   a deterministic function of the clock; the toolbar's Live control, where
   present, pauses and resumes that loop. */
import {
  METEOROLOGICAL_SEASON_MONTHS,
  accumulatedCells,
  createClimatologyAccumulator,
  filterByMonth,
  filterByTimeOfDay,
  foldClimatologyPoints,
  thresholdsToMps,
  windRose,
} from "@azohra/meteo.station";
import type { HistoryPoint, SpeedThresholds, StationClimatology } from "@azohra/meteo.station";
import { defineMeteoElements } from "@azohra/meteo.station/elements";
import type {
  BandChipElement,
  ClimatologyDailyPatternElement,
  ClimatologyRoseElement,
  CompassFanElement,
  CurrentConditionsElement,
  RecentSummariesElement,
  DailyPatternElement,
  StationFeedElement,
  WindHistoryChartElement,
  WindRoseElement,
} from "@azohra/meteo.station/elements";
import { buildExhibitFeed, buildHistoryLabStation, buildSeason } from "./station-exhibit";

const THRESHOLDS: SpeedThresholds = { unit: "kmh", values: [12, 20, 28] };

export function initStationGallery(): void {
  const feed = document.querySelector<StationFeedElement>("#station-feed");
  const heroFeed = document.querySelector<StationFeedElement>("#station-hero-feed");
  const wireJson = document.querySelector<HTMLPreElement>("#station-wire-json");
  const explicitConditions =
    document.querySelector<CurrentConditionsElement>("#explicit-conditions");

  /* The hero's terminal: the primary station's reading, printed as the wire
     carries it — the instrument below draws the same object. */
  const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const renderWire = (document_: ReturnType<typeof buildExhibitFeed>) => {
    if (!wireJson) return;
    const station = document_.stations[0];
    const reading = station?.reading;
    if (!reading) return;
    const entries: Array<[string, string | number]> = [
      ["observedAt", reading.observedAt],
      ["windAvgMps", reading.windAvgMps],
    ];
    if (reading.windDirectionDeg != null)
      entries.push(["windDirectionDeg", reading.windDirectionDeg]);
    if (reading.windGustMps != null) entries.push(["windGustMps", reading.windGustMps]);
    if (reading.windLullMps != null) entries.push(["windLullMps", reading.windLullMps]);
    if (reading.temperatureC != null) entries.push(["temperatureC", reading.temperatureC]);
    const lines = entries.map(([key, value], index) => {
      const printed =
        typeof value === "string"
          ? `<span class="t-str">"${escapeHtml(value)}"</span>`
          : `<span class="t-num">${value}</span>`;
      const comma = index < entries.length - 1 ? "," : "";
      return `  <span class="t-key">"${key}"</span>: ${printed}${comma}`;
    });
    wireJson.innerHTML = `{\n${lines.join("\n")}\n}`;
  };

  /* One publish feeds the providers AND the explicit-props instrument — the
     latter receives the same facts as direct properties, no ancestor. */
  const publish = () => {
    const now = Date.now();
    const document_ = buildExhibitFeed(now);
    if (feed) {
      feed.feed = document_;
      feed.receivedAtMs = now;
    }
    if (heroFeed) {
      heroFeed.feed = document_;
      heroFeed.receivedAtMs = now;
    }
    renderWire(document_);
    if (explicitConditions) {
      explicitConditions.station = document_.stations.find(
        (station) => station.id === "summit-logger",
      );
      explicitConditions.servedAt = document_.servedAt;
      explicitConditions.receivedAtMs = now;
    }
  };
  if (explicitConditions) explicitConditions.thresholds = THRESHOLDS;
  publish();

  /* Settled history: the History Lab's four days are built once, not per
     republish. */
  const historyLab = document.querySelector<WindHistoryChartElement>("#history-lab");
  if (historyLab) historyLab.station = buildHistoryLabStation(Date.now());

  /* The generated season feeds three exhibits; build it only when one of
     them is on the page. */
  const waysOutput = document.querySelector<HTMLElement>("#ways-output");
  const waysRose = document.querySelector<WindRoseElement>("#ways-rose");
  const seasonRose = document.querySelector<WindRoseElement>("#season-rose");
  const seasonCount = document.querySelector<HTMLElement>("#season-count");
  const pattern = document.querySelector<DailyPatternElement>("#station-pattern");
  const seasonConsumers =
    waysOutput ||
    waysRose ||
    seasonRose ||
    pattern ||
    document.querySelector("#climatology-rose") ||
    document.querySelector("#climatology-pattern");
  const season: HistoryPoint[] = seasonConsumers ? buildSeason() : [];

  /* "Two ways in": one fixed slice of the long history feeds both panels —
     the object windRose() returns and the component that draws it — so the
     section's claim ("same data") is literally true, not staged. */
  if (waysOutput && waysRose) {
    const midday = filterByTimeOfDay(
      filterByMonth(season, METEOROLOGICAL_SEASON_MONTHS.summer),
      9 * 60,
      15 * 60,
    );
    const rose = windRose(midday, 16);
    const busiest = rose.sectors.reduce((top, sector) =>
      sector.frequency > top.frequency ? sector : top,
    );
    waysOutput.textContent =
      `{\n  sampleCount: ${rose.sampleCount},\n  calmFraction: ${rose.calmFraction.toFixed(2)},\n` +
      `  sectors: [ /* 16 */ ],\n  // busiest:\n` +
      `  { bearingDeg: ${busiest.bearingDeg}, frequency: ${busiest.frequency.toFixed(2)},\n` +
      `    meanSpeedMps: ${busiest.meanSpeedMps?.toFixed(1) ?? "null"}, count: ${busiest.count} }\n}`;
    waysRose.points = midday;
  }

  /* The launch's favorable window rides the rose as a property. */
  const ridgeRose = document.querySelector<WindRoseElement>("#roses-ridge");
  if (ridgeRose) ridgeRose.favorableDirections = [{ fromDeg: 260, toDeg: 340 }];

  /* Seasons: the rose narrows; the typical day always averages the lot. */
  if (pattern) pattern.points = season;

  /* Live theatre: a deterministic sample ring and step blocks shaped like
     the vendor's own digests — wired as properties like every live host
     would. */
  const liveFan = document.querySelector<CompassFanElement>("#live-fan");
  const liveSummaries = document.querySelector<RecentSummariesElement>("#live-summaries");
  if (liveFan || liveSummaries) {
    const anchorMs = Date.now();
    const ring = {
      intervalSeconds: 3,
      points: Array.from({ length: 60 }, (_, index) => ({
        observedAt: new Date(anchorMs - (59 - index) * 3_000).toISOString(),
        windMps: 4.5 + Math.sin(index / 5) * 1.5,
        windDirectionDeg: (300 + Math.round(Math.sin(index / 4) * 18) + 360) % 360,
      })),
    };
    if (liveFan) liveFan.samples = ring;
    if (liveSummaries) {
      const step = (count: number, stepMinutes: number) =>
        Array.from({ length: count }, (_, index) => ({
          observedAt: new Date(anchorMs - (count - 1 - index) * stepMinutes * 60_000).toISOString(),
          windAvgMps: 4 + Math.sin(index / 2) * 1.2,
          windGustMps: 6.5 + Math.sin(index / 2) * 1.4,
          windLullMps: 2.2,
          windDirectionDeg: (295 + index * 4) % 360,
          temperatureC: null,
        }));
      liveSummaries.summaries = [
        { windowMinutes: 10, stepMinutes: 1, points: step(10, 1) },
        { windowMinutes: 60, stepMinutes: 5, points: step(12, 5) },
      ];
    }
  }

  /* Climatology: the same season folded ONCE into the cube; every filter
     below is a client-side re-sum of the held document — no refetch, which
     is the section's whole point. */
  const climatologyRose = document.querySelector<ClimatologyRoseElement>("#climatology-rose");
  const climatologyPattern =
    document.querySelector<ClimatologyDailyPatternElement>("#climatology-pattern");
  if (climatologyRose || climatologyPattern) {
    const accumulator = createClimatologyAccumulator({
      sectorCount: 16,
      slotMinutes: 180,
      thresholdsMps: thresholdsToMps(THRESHOLDS),
      utcOffsetMinutes: 0,
    });
    foldClimatologyPoints(accumulator, season);
    const expectedCount =
      season.length < 2
        ? 0
        : Math.round(
            (Date.parse((season[season.length - 1] as HistoryPoint).observedAt) -
              Date.parse((season[0] as HistoryPoint).observedAt)) /
              (180 * 60_000),
          );
    const cube: StationClimatology = {
      schemaVersion: 1,
      servedAt: new Date().toISOString(),
      stationId: "launch-ridge",
      sectorCount: 16,
      slotMinutes: 180,
      thresholdsMps: thresholdsToMps(THRESHOLDS),
      utcOffsetMinutes: 0,
      years: [{ year: 2026, sampleCount: season.length, expectedCount }],
      cells: accumulatedCells(accumulator),
    };
    if (climatologyRose) climatologyRose.document = cube;
    if (climatologyPattern) climatologyPattern.document = cube;

    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-climatology-months]",
    )) {
      button.addEventListener("click", () => {
        for (const sibling of document.querySelectorAll<HTMLButtonElement>(
          "[data-climatology-months]",
        )) {
          sibling.setAttribute("aria-pressed", String(sibling === button));
        }
        const pick = button.dataset.climatologyMonths;
        const months =
          pick === "july"
            ? "[7]"
            : pick === "winter"
              ? JSON.stringify(METEOROLOGICAL_SEASON_MONTHS.winter)
              : null;
        for (const element of [climatologyRose, climatologyPattern]) {
          if (!element) continue;
          if (months == null) element.removeAttribute("months");
          else element.setAttribute("months", months);
        }
      });
    }
  }

  /* Band words are the consumer's vocabulary — five words, four bounds. */
  for (const chip of document.querySelectorAll<BandChipElement>("meteo-band-chip")) {
    (chip as BandChipElement & { labels?: readonly string[] }).labels = [
      "calm",
      "light",
      "fine",
      "strong",
      "nuked",
    ];
  }

  /* All/Month/Season × time of day — the same filteredHistory the react
     demo computes, over the same generated season. */
  type FilterMode = "all" | "month" | "season";
  type Season = "winter" | "spring" | "summer" | "fall";
  type TimeOfDay = "all" | "midday" | "night";
  let filterMode: FilterMode = "all";
  let month = 1;
  let seasonPick: Season = "winter";
  let timeOfDay: TimeOfDay = "all";

  const applySeasonFilter = () => {
    if (!seasonRose || !seasonCount) return;
    const byMonth: HistoryPoint[] =
      filterMode === "all"
        ? season
        : filterMode === "month"
          ? filterByMonth(season, [month])
          : filterByMonth(season, METEOROLOGICAL_SEASON_MONTHS[seasonPick]);
    const narrowed =
      timeOfDay === "all"
        ? byMonth
        : timeOfDay === "midday"
          ? filterByTimeOfDay(byMonth, 9 * 60, 15 * 60)
          : filterByTimeOfDay(byMonth, 21 * 60, 6 * 60);
    seasonRose.points = narrowed;
    seasonCount.textContent = narrowed.length.toLocaleString();
  };
  applySeasonFilter();

  /* Data in place — define and upgrade in place. Elements defer their
     first render until connectedCallback has wired the ambient context,
     so the spec-ordered attribute reactions during an in-document
     upgrade are harmless no-ops. */
  defineMeteoElements();

  /* One segmented-control behaviour for every group. */
  const press = (buttons: HTMLButtonElement[], active: HTMLButtonElement) => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button === active));
    }
  };
  const wireGroup = (attribute: string, apply: (value: string) => void) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`)];
    for (const button of buttons) {
      button.addEventListener("click", () => {
        apply(button.getAttribute(`data-${attribute}`) as string);
        press(buttons, button);
      });
    }
  };

  /* The display unit: one attribute on the feed for every provider-fed
     element, and the same attribute on the explicit-props instrument. */
  wireGroup("unit", (unit) => {
    feed?.setAttribute("unit", unit);
    explicitConditions?.setAttribute("unit", unit);
  });

  /* Live / paused: the republish loop is the thing being toggled. */
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(publish, 5_000);
  const liveToggle = document.querySelector<HTMLButtonElement>("#station-live");
  const liveLabel = document.querySelector<HTMLElement>("#station-live-label");
  if (liveToggle && liveLabel) {
    liveToggle.addEventListener("click", () => {
      if (timer == null) {
        publish();
        timer = setInterval(publish, 5_000);
      } else {
        clearInterval(timer);
        timer = undefined;
      }
      const live = timer != null;
      liveToggle.setAttribute("aria-pressed", String(live));
      liveToggle.dataset.live = String(live);
      liveLabel.textContent = live ? "Live" : "Paused";
    });
  }

  /* History Lab: window-hours and compare-offset-days are plain attributes. */
  wireGroup("window", (hours) => {
    historyLab?.setAttribute("window-hours", hours);
  });
  wireGroup("compare", (days) => {
    if (!historyLab) return;
    if (days === "0") historyLab.removeAttribute("compare-offset-days");
    else historyLab.setAttribute("compare-offset-days", days);
  });

  /* Seasons controls: mode reveals its own picker; every change re-slices
     the same points. */
  const monthSelect = document.querySelector<HTMLSelectElement>("#season-month");
  const seasonGroup = document.querySelector<HTMLElement>("#season-season");
  wireGroup("filter-mode", (mode) => {
    filterMode = mode as FilterMode;
    if (monthSelect) monthSelect.hidden = filterMode !== "month";
    if (seasonGroup) seasonGroup.hidden = filterMode !== "season";
    applySeasonFilter();
  });
  monthSelect?.addEventListener("change", () => {
    month = Number(monthSelect.value);
    applySeasonFilter();
  });
  wireGroup("season", (pick) => {
    seasonPick = pick as Season;
    applySeasonFilter();
  });
  wireGroup("time-of-day", (pick) => {
    timeOfDay = pick as TimeOfDay;
    applySeasonFilter();
  });
}
