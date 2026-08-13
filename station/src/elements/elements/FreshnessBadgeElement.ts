import type { FreshnessStatus } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { freshnessBadgeSpan } from "../lib/fragments.js";

const STATUSES: readonly FreshnessStatus[] = ["live", "aging", "stale"];

export class FreshnessBadgeElement extends MeteoStationElement {
  static readonly observedAttributes = ["status"];

  protected override render(): void {
    const status = this.getAttribute("status");
    if (status == null || !(STATUSES as readonly string[]).includes(status)) {
      this.replaceChildren();
      return;
    }
    const { words } = this.display();
    this.replaceChildren(freshnessBadgeSpan(status as FreshnessStatus, words));
  }
}
