import { resolveStation } from "../../index.js";
import { recentSummariesGate, recentSummariesScene } from "../../scene/index.js";
import type { RecentSummary } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { windArrowSvg } from "../lib/fragments.js";

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
    const gate = recentSummariesGate(station, this.#summaries, words);
    if (gate.kind === "hidden") {
      this.replaceChildren();
      return;
    }
    if (gate.kind === "note") {
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }

    const scene = recentSummariesScene({
      favorableDirections,
      stationName: station?.name,
      summaries: gate.summaries,
      unit,
      words,
    });
    this.replaceChildren(
      h(
        "div",
        { "aria-label": scene.ariaLabel, class: scene.className },
        scene.panels.map((panel) =>
          h(
            "section",
            { class: panel.className },
            h("h4", { class: panel.label.className }, panel.label.text),
            h(
              "div",
              { class: "meteo-recent-summary-ghosts" },
              panel.ghosts.map((ghost) =>
                h("span", { class: ghost.className }, windArrowSvg(ghost.deg, 12)),
              ),
            ),
            h(
              "dl",
              { class: "meteo-recent-summary-stats" },
              panel.stats.map((stat) =>
                h(
                  "div",
                  { class: stat.className },
                  h("dt", { class: "meteo-microlabel" }, stat.label),
                  h("dd", null, stat.value),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
