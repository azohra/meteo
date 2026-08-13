import type { Station } from "../contract.js";
import { airRows, airSummary, lastStrikeWords } from "../air.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";

export type AirMatrixRow = {
  key: string;
  className: string;
  labelClassName: string;
  label: string;
  unit: string;
  cells: Array<{ key: string; className: string; text: string }>;
};

export type AirMatrixScene = {
  className: string;
  trigger: {
    className: string;
    title: { className: string; text: string };
    summary: { className: string; text: string };
  };
  panelClassName: string;
  matrix: {
    ariaLabel: string;
    className: string;
    gridTemplateColumns: string;
    head: {
      className: string;
      corner: { className: string };
      columnClassName: string;
      columns: Array<{ key: string; text: string }>;
    };
    rows: AirMatrixRow[];
  };
  note: { className: string; text: string };
};

export function airMatrixScene(input: {
  formatTime: FormatTime;
  stations: ReadonlyArray<Station>;
  words: StationStrings;
}): AirMatrixScene | null {
  const { formatTime, stations, words } = input;
  const capable = stations.filter((station) => station.capabilities.conditions);
  if (capable.length === 0) return null;

  const firstConditions =
    capable
      .map((station) => station.reading?.conditions ?? null)
      .find((conditions) => conditions != null) ?? null;

  const cellsOf = (value: (station: Station) => string | null): AirMatrixRow["cells"] =>
    capable.map((station) => ({
      key: station.id,
      className: "meteo-air-cell",
      text: value(station) ?? EM_DASH,
    }));

  const feelsLikeRows: AirMatrixRow[] = capable.some(
    (station) => station.reading?.windChillC != null,
  )
    ? [
        {
          key: words.air.feelsLike,
          className: "meteo-air-row",
          labelClassName: "meteo-air-label",
          label: words.air.feelsLike,
          unit: words.degC,
          cells: cellsOf((station) => station.reading?.windChillC?.toFixed(1) ?? null),
        },
      ]
    : [];

  const conditionRows: AirMatrixRow[] = airRows(words)
    .filter((row) =>
      capable.some((station) => {
        const conditions = station.reading?.conditions;
        return conditions != null && row.value(conditions) != null;
      }),
    )
    .map((row) => ({
      key: row.label,
      className: "meteo-air-row",
      labelClassName: "meteo-air-label",
      label: row.label,
      unit: row.unit,
      cells: cellsOf((station) => {
        const conditions = station.reading?.conditions;
        return conditions == null ? null : row.value(conditions);
      }),
    }));

  return {
    className: "meteo-air",
    trigger: {
      className: "meteo-air-trigger",
      title: { className: "meteo-air-title", text: words.air.title },
      summary: {
        className: "meteo-air-summary",
        text:
          firstConditions == null ? words.air.summaryFallback : airSummary(firstConditions, words),
      },
    },
    panelClassName: "meteo-air-panel",
    matrix: {
      ariaLabel: words.aria.air(capable.length),
      className: "meteo-air-matrix",
      gridTemplateColumns: `minmax(7.5rem, 1.4fr) repeat(${capable.length}, minmax(4.5rem, 1fr))`,
      head: {
        className: "meteo-air-row meteo-air-head",
        corner: { className: "meteo-air-corner" },
        columnClassName: "meteo-microlabel",
        columns: capable.map((station) => ({ key: station.id, text: station.name })),
      },
      rows: [...feelsLikeRows, ...conditionRows],
    },
    note: {
      className: "meteo-air-note",
      text:
        firstConditions == null
          ? words.air.noStrike
          : lastStrikeWords(firstConditions, formatTime, words),
    },
  };
}
