import { resolveStation } from "../../index.js";
import { recentSummariesScene } from "../../scene/index.js";
import type { RecentSummary } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderOptional } from "../lib/render.js";

export class RecentSummariesElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id", "unit"];

  #summaries: RecentSummary[] | null | undefined;

  constructor() {
    super();
    for (const name of ["summaries"]) this.upgradeProperty(name);
  }

  get summaries(): RecentSummary[] | null | undefined {
    return this.#summaries;
  }
  set summaries(value: RecentSummary[] | null | undefined) {
    this.#summaries = value;
    this.requestRender();
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#summaries == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { favorableDirections, unit, words } = this.display();
    this.replaceChildren(
      ...renderOptional(
        recentSummariesScene({
          favorableDirections,
          station,
          summaries: this.#summaries,
          unit,
          words,
        }),
      ),
    );
  }
}
