import { activeChartIndex, chartIndexAtClient, togglePinnedAt } from "../../scene/index.js";
import type { ChartFrame, ChartScales } from "../../geometry.js";

type CursorScene = {
  points: ReadonlyArray<{ observedAt: string }>;
  frame: ChartFrame;
  scales: ChartScales;
};

/* The pin/preview cursor shell both inspectable chart elements share:
 * hover previews (touch never does — a tap pins), click toggles the pin,
 * and leaving clears the preview. The element rebuilds its scene and svg
 * on render, so the shell reads both through accessors; onChange is the
 * element's cursor redraw. The React bindings carry the same shell in
 * react/lib/use-pinned-cursor.ts. */
export class PinnedCursor {
  #pinnedAt: string | null = null;
  #previewIndex: number | null = null;
  readonly #scene: () => CursorScene | null;
  readonly #svg: () => SVGElement | null;
  readonly #onChange: () => void;

  constructor(host: {
    scene: () => CursorScene | null;
    svg: () => SVGElement | null;
    onChange: () => void;
  }) {
    this.#scene = host.scene;
    this.#svg = host.svg;
    this.#onChange = host.onChange;
  }

  get previewIndex(): number | null {
    return this.#previewIndex;
  }

  activeIndex(): number | null {
    const scene = this.#scene();
    if (scene == null) return null;
    return activeChartIndex(scene.points, this.#pinnedAt, this.#previewIndex);
  }

  handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    this.#previewIndex = this.#indexAtPoint(event.clientX);
    this.#onChange();
  }

  handlePointerLeave(): void {
    this.#previewIndex = null;
    this.#onChange();
  }

  handleClick(event: MouseEvent): void {
    const index = this.#indexAtPoint(event.clientX);
    if (index == null) return;
    const observedAt = this.#scene()?.points[index]?.observedAt;
    if (observedAt == null) return;
    this.#pinnedAt = togglePinnedAt(this.#pinnedAt, observedAt);
    this.#previewIndex = null;
    this.#onChange();
  }

  #indexAtPoint(clientX: number): number | null {
    const scene = this.#scene();
    const svg = this.#svg();
    if (scene == null || svg == null) return null;
    return chartIndexAtClient(
      scene.points,
      scene.frame,
      scene.scales,
      clientX,
      svg.getBoundingClientRect(),
    );
  }
}
