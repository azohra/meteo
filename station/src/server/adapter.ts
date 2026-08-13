import {
  unavailableStation,
  type History,
  type Reading,
  type Station,
  type StationMeta,
} from "../contract.js";
import {
  logUpstreamFailure,
  resolveEnvironment,
  unavailableReasonForError,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "./environment.js";
import { DEFAULT_HISTORY_HOURS } from "./feed.js";

export type StationAdapterMode = "full" | "current";

export type StationAdapterOptions = {
  historyHours?: number;
  mode?: StationAdapterMode;
  environment?: ServerEnvironment;
};

export type StationAdapterContext<O extends StationAdapterOptions = StationAdapterOptions> = {
  readonly environment: ResolvedEnvironment;
  readonly historyHours: number;
  readonly mode: StationAdapterMode;
  readonly options: O;
};

export type StationAdapterResult = {
  readonly reading: Reading;
  readonly history: History | null;
  readonly meta?: Partial<StationMeta>;
};

export type StationAdapterDefinition<C, O extends StationAdapterOptions = StationAdapterOptions> = {
  readonly meta: (config: C) => StationMeta;
  readonly load: (config: C, context: StationAdapterContext<O>) => Promise<StationAdapterResult>;
};

export type StationAdapter<C, O extends StationAdapterOptions = StationAdapterOptions> = (
  config: C,
  options?: O,
) => Promise<Station>;

export function defineStationAdapter<C, O extends StationAdapterOptions = StationAdapterOptions>(
  definition: StationAdapterDefinition<C, O>,
): StationAdapter<C, O> {
  return async (config, options) => {
    const resolved = options ?? ({} as O);
    const environment = resolveEnvironment(resolved.environment);
    const mode = resolved.mode ?? "full";
    const meta = definition.meta(config);
    try {
      const result = await definition.load(config, {
        environment,
        historyHours: resolved.historyHours ?? DEFAULT_HISTORY_HOURS,
        mode,
        options: resolved,
      });
      return {
        ...meta,
        ...result.meta,
        status: "ok",
        reading: result.reading,
        history: mode === "current" ? null : result.history,
      };
    } catch (error) {
      logUpstreamFailure(environment, `${meta.name} live wind unavailable`, error, {
        station: meta.id,
      });
      return unavailableStation(meta, unavailableReasonForError(error));
    }
  };
}
