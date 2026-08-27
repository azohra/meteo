import type { Station } from "../contract.js";
import { airRows, airSummary, lastStrikeWords } from "../air.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { el, keyed, type SceneChild } from "./node.js";

type AirRowCells = SceneChild[];

/** The disclosure's own words, plus the panel it opens. The shell stays
 * with each binding: the trigger owns expansion state and its handler. */
export function airMatrixScene(input: {
  formatTime: FormatTime;
  stations: ReadonlyArray<Station>;
  words: StationStrings;
}): { title: string; summary: string; panel: SceneChild[] } | null {
  const { formatTime, stations, words } = input;
  const capable = stations.filter((station) => station.capabilities.conditions);
  if (capable.length === 0) return null;

  const firstConditions =
    capable
      .map((station) => station.reading?.conditions ?? null)
      .find((conditions) => conditions != null) ?? null;

  const rowTemplate = {
    gridTemplateColumns: `minmax(7.5rem, 1.4fr) repeat(${capable.length}, minmax(4.5rem, 1fr))`,
  };

  const cellsOf = (value: (station: Station) => string | null): AirRowCells =>
    capable.map((station) =>
      keyed(
        station.id,
        "span",
        { class: "meteo-air-cell", role: "cell" },
        value(station) ?? EM_DASH,
      ),
    );

  const row = (label: string, unit: string, cells: AirRowCells) => ({
    ...keyed(
      label,
      "div",
      { class: "meteo-air-row", role: "row" },
      el(
        "span",
        { class: "meteo-air-label", role: "rowheader" },
        label,
        el("small", undefined, unit),
      ),
      cells,
    ),
    style: rowTemplate,
  });

  const feelsLikeRows = capable.some((station) => station.reading?.windChillC != null)
    ? [
        row(
          words.air.feelsLike,
          words.degC,
          cellsOf((station) => station.reading?.windChillC?.toFixed(1) ?? null),
        ),
      ]
    : [];

  const conditionRows = airRows(words)
    .filter((entry) =>
      capable.some((station) => {
        const conditions = station.reading?.conditions;
        return conditions != null && entry.value(conditions) != null;
      }),
    )
    .map((entry) =>
      row(
        entry.label,
        entry.unit,
        cellsOf((station) => {
          const conditions = station.reading?.conditions;
          return conditions == null ? null : entry.value(conditions);
        }),
      ),
    );

  const panel: SceneChild[] = [
    el(
      "div",
      { "aria-label": words.aria.air(capable.length), class: "meteo-air-matrix", role: "table" },
      {
        ...el(
          "div",
          { class: "meteo-air-row meteo-air-head", role: "row" },
          el("span", { class: "meteo-air-corner", role: "columnheader" }),
          capable.map((station) =>
            keyed(
              station.id,
              "span",
              { class: "meteo-microlabel", role: "columnheader" },
              station.name,
            ),
          ),
        ),
        style: rowTemplate,
      },
      [...feelsLikeRows, ...conditionRows],
    ),
    el(
      "p",
      { class: "meteo-air-note" },
      firstConditions == null
        ? words.air.noStrike
        : lastStrikeWords(firstConditions, formatTime, words),
    ),
  ];

  return {
    title: words.air.title,
    summary:
      firstConditions == null ? words.air.summaryFallback : airSummary(firstConditions, words),
    panel,
  };
}
