/* Deterministic collision solvers for the sounding's in-plot labels.
   Both are pure geometry over already-sorted-stable inputs: identical
   input always yields identical placement, so golden SVGs stay bytes. */

export interface VerticalLabelInput {
  id: string;
  /** The label's true anchor y (the mark's own line), px. */
  trueY: number;
}

export interface VerticalLabelPlacement {
  id: string;
  trueY: number;
  /** Solved baseline-anchor y after nudging, clamped inside [topY, bottomY]. */
  y: number;
  /** True when the label moved beyond the leader threshold — the renderer draws a leader tick back to trueY. */
  leader: boolean;
}

export interface VerticalSolveOptions {
  /** Minimum anchor-to-anchor gap between adjacent labels, px. */
  minGapPx: number;
  /** Highest allowed label anchor (inclusive). */
  topY: number;
  /** Lowest allowed label anchor (inclusive). */
  bottomY: number;
  /** Nudge distance beyond which a label earns a leader tick. Default 4. */
  leaderThresholdPx?: number;
}

/**
 * Stacks labels that share a vertical lane: sort by true y (ties broken by
 * id, so coincident marks place identically every build), clamp into the
 * lane, then push overlapping labels apart to the minimum gap — downward
 * first, walking back up when the stack runs past the bottom. A label
 * nudged further than the threshold reports `leader: true`.
 */
export function solveVerticalLabels(
  inputs: ReadonlyArray<VerticalLabelInput>,
  options: VerticalSolveOptions,
): VerticalLabelPlacement[] {
  const threshold = options.leaderThresholdPx ?? 4;
  const sorted = [...inputs].sort(
    (left, right) => left.trueY - right.trueY || left.id.localeCompare(right.id),
  );
  const ys = sorted.map((entry) => Math.min(Math.max(entry.trueY, options.topY), options.bottomY));
  for (let index = 1; index < ys.length; index += 1) {
    ys[index] = Math.max(ys[index], ys[index - 1] + options.minGapPx);
  }
  if (ys.length > 0 && ys[ys.length - 1] > options.bottomY) {
    ys[ys.length - 1] = options.bottomY;
    for (let index = ys.length - 2; index >= 0; index -= 1) {
      ys[index] = Math.min(ys[index], ys[index + 1] - options.minGapPx);
    }
  }
  return sorted.map((entry, index) => ({
    id: entry.id,
    trueY: entry.trueY,
    y: ys[index],
    leader: Math.abs(ys[index] - entry.trueY) > threshold,
  }));
}

export interface RowLabelInput {
  id: string;
  /** Where the label wants its left edge, px. */
  naturalX: number;
  /** The label's full width (chip and text), px. */
  widthPx: number;
}

export interface RowLabelPlacement {
  id: string;
  /** Solved left edge, clamped inside [minX, maxX - width]. */
  x: number;
  /** 0 is the base row; each collision climbs one row. */
  row: number;
}

export interface RowSolveOptions {
  minX: number;
  maxX: number;
  /** Minimum horizontal gap between labels sharing a row, px. */
  gapPx: number;
}

/**
 * Places labels along a shared baseline, climbing to the next row when two
 * would overlap: sort by natural x (ties broken by id), clamp each into the
 * lane, then take the lowest row with horizontal room. Two traces meeting
 * at the surface — the parcel starts on the temperature trace — therefore
 * stack instead of overprinting.
 */
export function solveLabelRows(
  inputs: ReadonlyArray<RowLabelInput>,
  options: RowSolveOptions,
): RowLabelPlacement[] {
  const sorted = [...inputs].sort(
    (left, right) => left.naturalX - right.naturalX || left.id.localeCompare(right.id),
  );
  const rows: Array<Array<{ x1: number; x2: number }>> = [];
  return sorted.map((entry) => {
    const x = Math.max(options.minX, Math.min(entry.naturalX, options.maxX - entry.widthPx));
    let row = 0;
    const overlaps = (occupied: ReadonlyArray<{ x1: number; x2: number }>) =>
      occupied.some(
        (other) => x < other.x2 + options.gapPx && x + entry.widthPx + options.gapPx > other.x1,
      );
    while (overlaps(rows[row] ?? [])) row += 1;
    (rows[row] ??= []).push({ x1: x, x2: x + entry.widthPx });
    return { id: entry.id, x, row };
  });
}
