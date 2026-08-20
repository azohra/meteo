/**
 * Region-of-interest decode: reconstructs exact sample values at requested
 * grid points by entropy-decoding only the codeblocks whose coefficients
 * influence those points, then running a window-bounded inverse 5/3 lift
 * per resolution level.
 *
 * The mapping: a target rectangle at resolution r needs, at each level
 * transition r -> r-1, the raw wavelet coefficients inside its interleaved
 * window expanded by the 5/3 synthesis support margin (2 samples per side,
 * per dimension). The low-parity part of that window is the exact-output
 * rectangle demanded of resolution r-1; the high-parity parts name the
 * HL/LH/HH coefficients of level r. Chasing the recurrence down to
 * resolution 0 yields one small rectangle per level whose codeblocks are
 * the only ones that must be entropy-decoded.
 *
 * Exactness: a windowed lift computes bit-identical values at every output
 * whose full dependency cone (raw inputs within +-2, intermediate lifted
 * lows within +-1) lies inside the window. Windows carry a 2-sample margin
 * on every side that is not a true image boundary; where the window edge is
 * the true boundary, `lift`'s index clamping is exactly the full decoder's
 * boundary extension. So the exact region of each window is its unexpanded
 * core, and the recurrence only ever reads cores.
 *
 * Sharing: windows that overlap at any level merge into one node whose
 * demand is the bounding rectangle of its members' demands — the windowed
 * lift over the merged window runs once and every member reads from its
 * core, so nearby points (and every point's converging coarse-level
 * ancestry) never recompute shared work. Coefficients live in per-window
 * patch buffers sized to each rectangle; the full-resolution tile is never
 * allocated. Codeblocks are selected through a uniform grid index over the
 * tile-buffer layout and each selected codeblock is entropy-decoded exactly
 * once.
 */
import { lift } from "./dwt.js";
import { sampleRange } from "./image.js";
import type { CodeblockTask, ResolutionInfo } from "./packets.js";
import type { DecodePlan } from "./parallel.js";
import { decodeCodeblockTask, planDecode } from "./parallel.js";

/** Half the 5/3 synthesis filter support, rounded up: the per-side,
 * per-level window margin that keeps every dependency in-window. */
const MARGIN = 2;

/** Inclusive index span; empty when hi < lo. */
interface Span {
  lo: number;
  hi: number;
}

const spanCount = (s: Span): number => (s.hi < s.lo ? 0 : s.hi - s.lo + 1);

/** The indices i whose interleaved position parity + 2i lies in [lo, hi]. */
const parityIndices = (lo: number, hi: number, parity: number): Span => ({
  lo: Math.ceil((lo - parity) / 2),
  hi: Math.floor((hi - parity) / 2),
});

/** Inclusive rectangle; the coordinate space depends on context (a
 * resolution's own grid, or the quadrant tile-buffer layout). */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle of raw coefficients held in its own buffer: the region
 * decoder's replacement for the full-resolution tile. Coordinates are the
 * tile-buffer layout's; `data` is row-major over the rectangle. */
interface Patch {
  x0: number;
  y0: number;
  w: number;
  h: number;
  data: Int32Array;
}

const patchOf = (x0: number, y0: number, w: number, h: number): Patch => ({
  x0,
  y0,
  w,
  h,
  data: new Int32Array(w * h),
});

/**
 * One level transition's windowed-IDWT node: the merged exact-output
 * demand at resolution r, its margin-expanded raw-input window, and the
 * de-interleaved spans that name its coefficient rectangles.
 */
interface RegionNode {
  /** Exact-output rectangle at resolution r (the window's core). */
  demand: Rect;
  /** Raw-input window, inclusive, in interleaved coordinates — which are
   * exactly resolution r's buffer coordinates. */
  xi0: number;
  xi1: number;
  yi0: number;
  yi1: number;
  /** De-interleaved input spans: low/high columns, low/high rows. Low
   * columns x low rows is the LL demand (resolution r-1's exact-output
   * rect); the other three quadrant combinations are this level's HL, LH,
   * and HH coefficient demands. */
  xl: Span;
  xh: Span;
  yl: Span;
  yh: Span;
  /** Node at transition r-1 (or base patch, at r === 1) whose core covers
   * this node's LL demand; -1 when the LL demand is empty. */
  parent: number;
  /** This level's coefficient patches; absent when the span is empty. */
  hl: Patch | undefined;
  lh: Patch | undefined;
  hh: Patch | undefined;
  /** Lifted resolution-r samples over the window, exact on the core. */
  out: Int32Array;
}

/** A demand rectangle awaiting merging, remembering what asked for it:
 * a point (at the finest level) or a node index (below it). */
interface Demand {
  rect: Rect;
  source: number;
}

/** Merged demand groups: rectangles whose margin-expanded windows overlap
 * collapse into one bounding demand, until all windows are pairwise
 * disjoint. `margin` 0 merges on plain overlap (the base level, where
 * coefficients are read raw and no window exists). */
function mergeDemands(
  demands: readonly Demand[],
  clampW: number,
  clampH: number,
  margin: number,
): Array<{ rect: Rect; sources: number[] }> {
  let groups = demands.map((d) => ({ rect: { ...d.rect }, sources: [d.source] }));
  for (;;) {
    const windows = groups.map((g) => ({
      x0: Math.max(0, g.rect.x0 - margin),
      x1: Math.min(clampW - 1, g.rect.x1 + margin),
      y0: Math.max(0, g.rect.y0 - margin),
      y1: Math.min(clampH - 1, g.rect.y1 + margin),
    }));
    const parent = groups.map((_, i) => i);
    const find = (i: number): number => {
      let root = i;
      while (parent[root] !== root) root = parent[root]!;
      while (parent[i] !== root) {
        const next = parent[i]!;
        parent[i] = root;
        i = next;
      }
      return root;
    };
    // Plane sweep over window x-extents; y-overlap within the active set
    // unions the pair.
    const order = groups.map((_, i) => i).sort((a, b) => windows[a]!.x0 - windows[b]!.x0);
    const active: number[] = [];
    let merged = false;
    for (const i of order) {
      const wi = windows[i]!;
      for (let k = active.length - 1; k >= 0; k--) {
        if (windows[active[k]!]!.x1 < wi.x0) active.splice(k, 1);
      }
      for (const j of active) {
        const wj = windows[j]!;
        if (wj.y0 <= wi.y1 && wj.y1 >= wi.y0) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) {
            parent[ri] = rj;
            merged = true;
          }
        }
      }
      active.push(i);
    }
    if (!merged) return groups;
    const byRoot = new Map<number, { rect: Rect; sources: number[] }>();
    groups.forEach((group, i) => {
      const root = find(i);
      const existing = byRoot.get(root);
      if (existing === undefined) {
        byRoot.set(root, group);
      } else {
        existing.rect.x0 = Math.min(existing.rect.x0, group.rect.x0);
        existing.rect.y0 = Math.min(existing.rect.y0, group.rect.y0);
        existing.rect.x1 = Math.max(existing.rect.x1, group.rect.x1);
        existing.rect.y1 = Math.max(existing.rect.y1, group.rect.y1);
        existing.sources.push(...group.sources);
      }
    });
    groups = [...byRoot.values()];
  }
}

/** Builds one transition's node from its merged demand: the same window
 * and span geometry the feasibility spike proved, applied to a rectangle. */
function nodeOf(res: ResolutionInfo, demand: Rect): RegionNode {
  const hcas = res.x0 & 1;
  const vcas = res.y0 & 1;
  const xi0 = Math.max(0, demand.x0 - MARGIN);
  const xi1 = Math.min(res.width - 1, demand.x1 + MARGIN);
  const yi0 = Math.max(0, demand.y0 - MARGIN);
  const yi1 = Math.min(res.height - 1, demand.y1 + MARGIN);
  return {
    demand,
    xi0,
    xi1,
    yi0,
    yi1,
    xl: parityIndices(xi0, xi1, hcas),
    xh: parityIndices(xi0, xi1, 1 - hcas),
    yl: parityIndices(yi0, yi1, vcas),
    yh: parityIndices(yi0, yi1, 1 - vcas),
    parent: -1,
    hl: undefined,
    lh: undefined,
    hh: undefined,
    out: new Int32Array((xi1 - xi0 + 1) * (yi1 - yi0 + 1)),
  };
}

/** The planned window graph: nodes per transition level (index r; 0
 * unused), raw resolution-0 patches, and each point's finest owner. */
interface RegionPlan {
  stages: RegionNode[][];
  basePatches: Patch[];
  /** Per requested point: its node index at the finest transition, or its
   * base-patch index when the ladder has no transitions. */
  owner: Int32Array;
}

function planRegion(
  resolutions: ResolutionInfo[],
  px: ArrayLike<number>,
  py: ArrayLike<number>,
): RegionPlan {
  const finest = resolutions.length - 1;
  const owner = new Int32Array(px.length);
  const stages: RegionNode[][] = [];
  let demands: Demand[] = [];
  for (let i = 0; i < px.length; i++) {
    demands.push({ rect: { x0: px[i]!, y0: py[i]!, x1: px[i]!, y1: py[i]! }, source: i });
  }

  for (let r = finest; r >= 1; r--) {
    const res = resolutions[r]!;
    const groups = mergeDemands(demands, res.width, res.height, MARGIN);
    const nodes = groups.map((group) => nodeOf(res, group.rect));
    groups.forEach((group, nodeIndex) => {
      for (const source of group.sources) {
        if (r === finest) owner[source] = nodeIndex;
        else stages[r + 1]![source]!.parent = nodeIndex;
      }
    });
    stages[r] = nodes;
    demands = [];
    nodes.forEach((node, nodeIndex) => {
      if (spanCount(node.xl) > 0 && spanCount(node.yl) > 0) {
        demands.push({
          rect: { x0: node.xl.lo, y0: node.yl.lo, x1: node.xl.hi, y1: node.yl.hi },
          source: nodeIndex,
        });
      }
    });
  }

  // Resolution 0 is read raw: its patches are the level-1 LL demands (or
  // the points themselves when the ladder has no transitions).
  const res0 = resolutions[0]!;
  const groups = mergeDemands(demands, res0.width, res0.height, 0);
  const basePatches = groups.map((group) =>
    patchOf(
      group.rect.x0,
      group.rect.y0,
      group.rect.x1 - group.rect.x0 + 1,
      group.rect.y1 - group.rect.y0 + 1,
    ),
  );
  groups.forEach((group, patchIndex) => {
    for (const source of group.sources) {
      if (finest === 0) owner[source] = patchIndex;
      else stages[1]![source]!.parent = patchIndex;
    }
  });

  // Allocate each transition's coefficient patches at their tile-buffer
  // rectangles. The quadrant layout partitions the tile buffer across
  // levels, so every patch names distinct coefficients.
  for (let r = 1; r <= finest; r++) {
    const prev = resolutions[r - 1]!;
    for (const node of stages[r]!) {
      const xlN = spanCount(node.xl);
      const xhN = spanCount(node.xh);
      const ylN = spanCount(node.yl);
      const yhN = spanCount(node.yh);
      if (xhN > 0 && ylN > 0) node.hl = patchOf(prev.width + node.xh.lo, node.yl.lo, xhN, ylN);
      if (xlN > 0 && yhN > 0) node.lh = patchOf(node.xl.lo, prev.height + node.yh.lo, xlN, yhN);
      if (xhN > 0 && yhN > 0) {
        node.hh = patchOf(prev.width + node.xh.lo, prev.height + node.yh.lo, xhN, yhN);
      }
    }
  }

  return { stages, basePatches, owner };
}

/** Every coefficient patch in the plan, in one list for codeblock
 * selection and placement. */
function allPatches(plan: RegionPlan): Patch[] {
  const patches = [...plan.basePatches];
  for (const nodes of plan.stages) {
    if (nodes === undefined) continue;
    for (const node of nodes) {
      if (node.hl !== undefined) patches.push(node.hl);
      if (node.lh !== undefined) patches.push(node.lh);
      if (node.hh !== undefined) patches.push(node.hh);
    }
  }
  return patches;
}

/** A uniform-grid spatial index over the codeblock tasks' tile-buffer
 * rectangles: flat counting-sorted buckets, built once per decode. */
interface TaskGrid {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  /** bucketStart[c] .. bucketStart[c + 1] indexes into taskIds. */
  bucketStart: Int32Array;
  taskIds: Int32Array;
}

function buildTaskGrid(
  tasks: readonly CodeblockTask[],
  width: number,
  height: number,
  cellW: number,
  cellH: number,
): TaskGrid {
  const cols = Math.max(1, Math.ceil(width / cellW));
  const rows = Math.max(1, Math.ceil(height / cellH));
  const counts = new Int32Array(cols * rows + 1);
  const cellRange = (task: CodeblockTask): [number, number, number, number] => [
    Math.floor(task.tileX / cellW),
    Math.floor((task.tileX + task.width - 1) / cellW),
    Math.floor(task.tileY / cellH),
    Math.floor((task.tileY + task.height - 1) / cellH),
  ];
  for (const task of tasks) {
    const [cx0, cx1, cy0, cy1] = cellRange(task);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) counts[cy * cols + cx + 1]++;
    }
  }
  for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
  const bucketStart = counts.slice();
  const taskIds = new Int32Array(counts[counts.length - 1]!);
  const cursor = counts.slice(0, -1);
  tasks.forEach((task, taskId) => {
    const [cx0, cx1, cy0, cy1] = cellRange(task);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        taskIds[cursor[cy * cols + cx]!++] = taskId;
      }
    }
  });
  return { cellW, cellH, cols, rows, bucketStart, taskIds };
}

/** Copies the intersection of a decoded codeblock into a patch. */
function placeIntoPatch(patch: Patch, task: CodeblockTask, coefficients: Int32Array): void {
  const x0 = Math.max(task.tileX, patch.x0);
  const y0 = Math.max(task.tileY, patch.y0);
  const x1 = Math.min(task.tileX + task.width - 1, patch.x0 + patch.w - 1);
  const y1 = Math.min(task.tileY + task.height - 1, patch.y0 + patch.h - 1);
  for (let y = y0; y <= y1; y++) {
    const from = (y - task.tileY) * task.width - task.tileX;
    const to = (y - patch.y0) * patch.w - patch.x0;
    for (let x = x0; x <= x1; x++) patch.data[to + x] = coefficients[from + x]!;
  }
}

/**
 * Entropy-decodes exactly the codeblocks the patches touch — each selected
 * codeblock once, found through the grid index — and scatters each into
 * every patch it intersects. Returns how many codeblocks were decoded.
 */
function fillPatches(
  codestream: Uint8Array,
  tasks: readonly CodeblockTask[],
  grid: TaskGrid,
  patches: readonly Patch[],
): number {
  const stamp = new Int32Array(tasks.length).fill(-1);
  const targets = new Map<number, Patch[]>();
  patches.forEach((patch, patchId) => {
    const cx0 = Math.floor(patch.x0 / grid.cellW);
    const cx1 = Math.min(grid.cols - 1, Math.floor((patch.x0 + patch.w - 1) / grid.cellW));
    const cy0 = Math.floor(patch.y0 / grid.cellH);
    const cy1 = Math.min(grid.rows - 1, Math.floor((patch.y0 + patch.h - 1) / grid.cellH));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = cy * grid.cols + cx;
        for (let at = grid.bucketStart[cell]!; at < grid.bucketStart[cell + 1]!; at++) {
          const taskId = grid.taskIds[at]!;
          if (stamp[taskId] === patchId) continue;
          stamp[taskId] = patchId;
          const task = tasks[taskId]!;
          if (
            task.tileX <= patch.x0 + patch.w - 1 &&
            task.tileX + task.width - 1 >= patch.x0 &&
            task.tileY <= patch.y0 + patch.h - 1 &&
            task.tileY + task.height - 1 >= patch.y0
          ) {
            let list = targets.get(taskId);
            if (list === undefined) targets.set(taskId, (list = []));
            list.push(patch);
          }
        }
      }
    }
  });
  for (const [taskId, list] of targets) {
    const task = tasks[taskId]!;
    const coefficients = decodeCodeblockTask(
      codestream.subarray(task.byteOffset, task.byteOffset + task.byteLength),
      task,
    );
    for (const patch of list) placeIntoPatch(patch, task, coefficients);
  }
  return targets.size;
}

/**
 * Runs the windowed inverse lifts, coarse to fine: per node, a windowed
 * horizontal lift over the window's rows (low rows read the parent's core
 * plus this level's HL coefficients; high rows read LH plus HH), then a
 * windowed vertical lift. Bit-identical to inverseDwt53 on every core by
 * the margin argument at the top of this file.
 */
function reconstruct(plan: RegionPlan, resolutions: ResolutionInfo[]): void {
  let maxLen = 1;
  for (const nodes of plan.stages) {
    if (nodes === undefined) continue;
    for (const node of nodes) {
      maxLen = Math.max(maxLen, node.xi1 - node.xi0 + 1, node.yi1 - node.yi0 + 1);
    }
  }
  const line = new Int32Array(maxLen);
  const scratch = new Int32Array(maxLen + 1);

  for (let r = 1; r < resolutions.length; r++) {
    const res = resolutions[r]!;
    const prevNodes = plan.stages[r - 1];
    const hcas = res.x0 & 1;
    const vcas = res.y0 & 1;
    for (const node of plan.stages[r]!) {
      const xiW = node.xi1 - node.xi0 + 1;
      const yiH = node.yi1 - node.yi0 + 1;
      const xlN = spanCount(node.xl);
      const xhN = spanCount(node.xh);
      const ylN = spanCount(node.yl);
      const yhN = spanCount(node.yh);
      const out = node.out;
      // The parent's exact core holds this node's LL demand: a base patch
      // at r === 1, the previous transition's window buffer above it.
      const base = r === 1 ? plan.basePatches[node.parent] : undefined;
      const parent = r === 1 ? undefined : prevNodes![node.parent];
      // Window-relative parity of the first low sample; an all-high window
      // is a lone high sample, which lift() treats as startParity 1.
      const hParity = xlN > 0 ? hcas + 2 * node.xl.lo - node.xi0 : 1;
      const vParity = ylN > 0 ? vcas + 2 * node.yl.lo - node.yi0 : 1;
      // Mirror inverseDwt53's skip conditions exactly.
      const liftRows = res.width > 1 || hcas === 1;
      const liftColumns = res.height > 1 || vcas === 1;

      for (let j = 0; j < yiH; j++) {
        const p = node.yi0 + j;
        if ((p & 1) === vcas) {
          // A low row: resolution r-1 samples from the parent's core, then
          // this level's HL coefficients.
          const u = (p - vcas) >> 1;
          if (xlN > 0) {
            if (base !== undefined) {
              const from = (u - base.y0) * base.w - base.x0;
              for (let i = 0; i < xlN; i++) line[i] = base.data[from + node.xl.lo + i]!;
            } else {
              const pw = parent!;
              const from = (u - pw.yi0) * (pw.xi1 - pw.xi0 + 1) - pw.xi0;
              for (let i = 0; i < xlN; i++) line[i] = pw.out[from + node.xl.lo + i]!;
            }
          }
          if (xhN > 0) {
            const hl = node.hl!;
            const from = (u - hl.y0) * hl.w;
            for (let i = 0; i < xhN; i++) line[xlN + i] = hl.data[from + i]!;
          }
        } else {
          // A high row: this level's LH then HH coefficients.
          const k = (p - (1 - vcas)) >> 1;
          if (xlN > 0) {
            const lh = node.lh!;
            const from = (k + resolutions[r - 1]!.height - lh.y0) * lh.w;
            for (let i = 0; i < xlN; i++) line[i] = lh.data[from + i]!;
          }
          if (xhN > 0) {
            const hh = node.hh!;
            const from = (k + resolutions[r - 1]!.height - hh.y0) * hh.w;
            for (let i = 0; i < xhN; i++) line[xlN + i] = hh.data[from + i]!;
          }
        }
        if (liftRows) lift(line, scratch, xlN, xhN, hParity);
        for (let x = 0; x < xiW; x++) out[j * xiW + x] = line[x]!;
      }

      if (liftColumns) {
        for (let x = 0; x < xiW; x++) {
          for (let i = 0; i < ylN; i++) {
            line[i] = out[(vcas + 2 * (node.yl.lo + i) - node.yi0) * xiW + x]!;
          }
          for (let i = 0; i < yhN; i++) {
            line[ylN + i] = out[(1 - vcas + 2 * (node.yh.lo + i) - node.yi0) * xiW + x]!;
          }
          lift(line, scratch, ylN, yhN, vParity);
          for (let j = 0; j < yiH; j++) out[j * xiW + x] = line[j]!;
        }
      }
    }
  }
}

/** What a region decode returns: the header facts of the codestream and
 * the exact samples at the requested indexes. */
export interface J2kRegionDecodeResult {
  /** DC-shifted, range-clamped samples, one per requested index in request
   * order, equal to decodeJ2k(codestream).values[index] bit for bit. */
  values: Int32Array;
  width: number;
  height: number;
  bitsPerSample: number;
  isSigned: boolean;
  /** Always 1 in this decoder's subset. */
  componentCount: 1;
  /** Codeblocks actually entropy-decoded for these points. */
  codeblocksDecoded: number;
  /** Codeblocks the codestream carries. */
  codeblocksTotal: number;
}

/**
 * decodeJ2kRegion over an already parsed plan: reuse the plan when several
 * point sets sample one codestream.
 */
export function decodeRegionFromPlan(
  codestream: Uint8Array,
  plan: DecodePlan,
  indices: ArrayLike<number>,
): J2kRegionDecodeResult {
  const { header, resolutions, tasks } = plan;
  const { width, height } = header;
  const samples = width * height;

  const px = new Int32Array(indices.length);
  const py = new Int32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]!;
    if (!Number.isInteger(index) || index < 0 || index >= samples) {
      throw new RangeError(`sample index ${index} is outside the ${samples}-sample image`);
    }
    px[i] = index % width;
    py[i] = Math.floor(index / width);
  }

  const regionPlan = planRegion(resolutions, px, py);
  const grid = buildTaskGrid(tasks, width, height, header.codeblockWidth, header.codeblockHeight);
  const codeblocksDecoded = fillPatches(codestream, tasks, grid, allPatches(regionPlan));
  reconstruct(regionPlan, resolutions);

  const finest = resolutions.length - 1;
  const { shift, min, max } = sampleRange(header.bitsPerSample, header.isSigned);
  const values = new Int32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    let raw: number;
    if (finest === 0) {
      const patch = regionPlan.basePatches[regionPlan.owner[i]!]!;
      raw = patch.data[(py[i]! - patch.y0) * patch.w + (px[i]! - patch.x0)]!;
    } else {
      const node = regionPlan.stages[finest]![regionPlan.owner[i]!]!;
      raw = node.out[(py[i]! - node.yi0) * (node.xi1 - node.xi0 + 1) + (px[i]! - node.xi0)]!;
    }
    const v = raw + shift;
    values[i] = v < min ? min : v > max ? max : v;
  }
  return {
    values,
    width,
    height,
    bitsPerSample: header.bitsPerSample,
    isSigned: header.isSigned,
    componentCount: 1,
    codeblocksDecoded,
    codeblocksTotal: tasks.length,
  };
}

/**
 * Decodes a raw JPEG 2000 codestream at the requested full-grid raster
 * indexes only (index = y * width + x): full header and packet-structure
 * parse (unavoidable — packet lengths are only discoverable sequentially),
 * then entropy decode and windowed inverse DWT restricted to the
 * codeblocks and windows the points actually touch.
 *
 * The exactness contract: every returned value equals
 * `decodeJ2k(codestream).values[index]` bit for bit — region decode is a
 * cheaper route to the same integers, never an approximation.
 *
 * The envelope is the package's (single tile, single component, reversible
 * 5/3, one quality layer); anything outside it fails loudly in the parse
 * with UnsupportedJ2kError or J2kFormatError, exactly as decodeJ2k does.
 * An index outside the image throws a RangeError.
 */
export function decodeJ2kRegion(
  codestream: Uint8Array,
  indices: ArrayLike<number>,
): J2kRegionDecodeResult {
  return decodeRegionFromPlan(codestream, planDecode(codestream), indices);
}
