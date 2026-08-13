"use client";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import {
  STATION_CARD_CLASS,
  cardHeaderScene,
  cardPartThresholds,
  cardPartWiringError,
  summaryScene,
} from "../../scene/index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { mergeStringOverrides } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { CurrentConditions } from "./CurrentConditions.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindHistoryChart } from "./WindHistoryChart.js";

type StationCardContextValue = {
  station: Station;
  servedAt: string | null;
  receivedAtMs: number | null;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  strings: StationStringOverrides | undefined;
  formatTime: FormatTime;
};

const StationCardContext = createContext<StationCardContextValue | null>(null);

function useStationCardContext(subcomponent: string): StationCardContextValue {
  const context = useContext(StationCardContext);
  if (context == null) {
    throw new Error(cardPartWiringError(`<StationCard.${subcomponent}>`, "<StationCard>"));
  }
  return context;
}

function StationCardRoot({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
  children,
}: {
  station?: Station;
  stationId?: string;
  servedAt?: string;
  receivedAtMs?: number | null;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
  children?: ReactNode;
}) {
  const ambient = useStationFeedContext();
  const station = requireResolved(
    "StationCard",
    "station",
    stationProp ?? resolveStation(ambient, stationId),
  );
  const servedAt = servedAtProp ?? ambient?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (ambient?.receivedAtMs ?? null);
  const { formatTime, strings, thresholds, unit } = resolveDisplay(ambient, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  return (
    <StationCardContext.Provider
      value={{ station, servedAt, receivedAtMs, thresholds, unit, strings, formatTime }}
    >
      <article className={STATION_CARD_CLASS} data-status={station.status}>
        {children === undefined ? (
          <>
            <StationCardHeader />
            <StationCardInstrument />
            <StationCardChart />
            <StationCardSummary />
          </>
        ) : (
          children
        )}
      </article>
    </StationCardContext.Provider>
  );
}

export function StationCardHeader({
  strings,
}: {
  strings?: StationStringOverrides;
} = {}) {
  const context = useStationCardContext("Header");
  const { station, servedAt, receivedAtMs } = context;
  const { strings: resolvedStrings, words } = resolveDisplay(context, { strings });
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  const scene = cardHeaderScene(station, words);
  const { name, meta } = scene.identity;

  return (
    <header className={scene.className}>
      <div className={scene.identity.className}>
        <h3 className={name.className}>
          {name.link ? (
            <a href={name.link.href} rel={name.link.rel} target={name.link.target}>
              {name.link.text}
            </a>
          ) : (
            name.text
          )}
        </h3>
        <p className={meta.className}>
          <span className={meta.source.className}>{meta.source.text}</span>
          {meta.elevation && (
            <span className={meta.elevation.className}>{meta.elevation.text}</span>
          )}
        </p>
      </div>
      {status != null && <FreshnessBadge status={status} strings={resolvedStrings} />}
    </header>
  );
}

export function StationCardInstrument({
  thresholds,
  unit,
  strings,
  formatTime,
}: {
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useStationCardContext("Instrument");
  return (
    <CurrentConditions
      formatTime={formatTime ?? context.formatTime}
      receivedAtMs={context.receivedAtMs}
      servedAt={context.servedAt}
      station={context.station}
      strings={mergeStringOverrides(context.strings, strings)}
      thresholds={cardPartThresholds(thresholds, context.thresholds)}
      unit={unit ?? context.unit}
    />
  );
}

export function StationCardChart({
  thresholds,
  unit,
  plotHeight,
  strings,
  formatTime,
}: {
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useStationCardContext("Chart");
  return (
    <WindHistoryChart
      formatTime={formatTime ?? context.formatTime}
      plotHeight={plotHeight}
      station={context.station}
      strings={mergeStringOverrides(context.strings, strings)}
      thresholds={cardPartThresholds(thresholds, context.thresholds)}
      unit={unit ?? context.unit}
    />
  );
}

export function StationCardSummary({
  unit,
  strings,
  formatTime,
}: {
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useStationCardContext("Summary");
  const {
    formatTime: resolvedFormatTime,
    unit: resolvedUnit,
    words,
  } = resolveDisplay(context, {
    formatTime,
    strings,
    unit,
  });
  const { station } = context;

  const summary = summaryScene(station, resolvedUnit, words, resolvedFormatTime);
  if (summary == null) return null;

  return (
    <dl aria-label={summary.ariaLabel} className={summary.className}>
      {summary.items.map((item) => (
        <div className={summary.itemClassName} key={item.label}>
          <dt className={summary.labelClassName}>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const StationCard = Object.assign(StationCardRoot, {
  Header: StationCardHeader,
  Instrument: StationCardInstrument,
  Chart: StationCardChart,
  Summary: StationCardSummary,
});
