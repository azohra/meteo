export interface PlotPoint {
  x: number;
  y: number;
}

/** Rounds to two decimals without reintroducing float noise in the string. */
export function short(value: number): number {
  return Number(value.toFixed(2));
}

/* The Catmull-Rom-flavoured control points of one cubic segment — the one
   home for the formula, shared by the serializer below and pathYAtX so a
   query can never drift from the drawn stroke. */
function segmentControls(
  points: readonly PlotPoint[],
  index: number,
): { firstX: number; firstY: number; secondX: number; secondY: number } {
  const previous = points[Math.max(0, index - 1)];
  const current = points[index];
  const next = points[index + 1];
  const following = points[Math.min(points.length - 1, index + 2)];
  return {
    firstX: current.x + (next.x - previous.x) / 6,
    firstY: current.y + (next.y - previous.y) / 6,
    secondX: next.x - (following.x - current.x) / 6,
    secondY: next.y - (following.y - current.y) / 6,
  };
}

function curvedSegments(points: readonly PlotPoint[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) return ` L${short(points[1].x)},${short(points[1].y)}`;
  let result = "";
  for (let index = 0; index < points.length - 1; index += 1) {
    const next = points[index + 1];
    const { firstX, firstY, secondX, secondY } = segmentControls(points, index);
    result += ` C${short(firstX)},${short(firstY)} ${short(secondX)},${short(secondY)} ${short(next.x)},${short(next.y)}`;
  }
  return result;
}

/** Catmull-Rom-flavoured cubic through every point. */
export function curvedPath(points: readonly PlotPoint[]): string {
  if (points.length === 0) return "";
  return `M${short(points[0].x)},${short(points[0].y)}${curvedSegments(points)}`;
}

/** Curved path over the non-null points; nulls break the line into segments. */
export function pointPath(points: ReadonlyArray<PlotPoint | null>): string {
  const paths: string[] = [];
  let segment: PlotPoint[] = [];
  for (const point of [...points, null]) {
    if (point) {
      segment.push(point);
      continue;
    }
    if (segment.length > 0) paths.push(curvedPath(segment));
    segment = [];
  }
  return paths.join(" ");
}

/** Curved path plus the lone points a stroke cannot show: nulls split runs, runs of two or more become path segments, and a run of one — which `pointPath` would emit as an invisible bare moveto — surfaces as a dot for the renderer to draw. */
export function sampledPath(points: ReadonlyArray<PlotPoint | null>): {
  path: string;
  dots: PlotPoint[];
} {
  const paths: string[] = [];
  const dots: PlotPoint[] = [];
  let segment: PlotPoint[] = [];
  for (const point of [...points, null]) {
    if (point) {
      segment.push(point);
      continue;
    }
    if (segment.length === 1) dots.push(segment[0]);
    else if (segment.length > 1) paths.push(curvedPath(segment));
    segment = [];
  }
  return { path: paths.join(" "), dots };
}

function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/**
 * y of the drawn series line at an arbitrary x, or null where the line is
 * broken or x falls outside every run. Nulls split the points into runs
 * exactly as `pointPath` does, a two-point run is the straight segment the
 * serializer draws, and longer runs invert the same cubic
 * `segmentControls` feeds the stroke — so a caller's continuation stub or
 * cursor anchor meets the line instead of a straight-line approximation
 * drifting off it. Within a run x must increase monotonically (plot
 * columns do; control xs lean forward over uniform pitch), so bisection
 * on t converges.
 */
export function pathYAtX(points: ReadonlyArray<PlotPoint | null>, x: number): number | null {
  let run: PlotPoint[] = [];
  for (const point of [...points, null]) {
    if (point) {
      run.push(point);
      continue;
    }
    const y = runYAtX(run, x);
    if (y !== null) return y;
    run = [];
  }
  return null;
}

function runYAtX(run: readonly PlotPoint[], x: number): number | null {
  if (run.length < 2 || x < run[0].x || x > run[run.length - 1].x) return null;
  const index = run.findIndex(
    (point, at) => at < run.length - 1 && x >= point.x && x <= run[at + 1].x,
  );
  if (index === -1) return null;
  const current = run[index];
  const next = run[index + 1];
  if (run.length === 2) {
    return current.y + ((x - current.x) / (next.x - current.x)) * (next.y - current.y);
  }
  const { firstX, firstY, secondX, secondY } = segmentControls(run, index);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (cubicAt(current.x, firstX, secondX, next.x, mid) < x) low = mid;
    else high = mid;
  }
  const t = (low + high) / 2;
  return cubicAt(current.y, firstY, secondY, next.y, t);
}

/** Translucent envelope between two edges (ensemble p25-p75 bands), using the same curved segments as the median line so the line can never exit its own envelope; nulls split the band into runs. */
export function bandPath(
  points: ReadonlyArray<{ x: number; yLow: number; yHigh: number } | null>,
): string {
  const paths: string[] = [];
  let run: Array<{ x: number; yLow: number; yHigh: number }> = [];
  const flush = () => {
    if (run.length >= 2) {
      const upper = run.map((p) => ({ x: p.x, y: p.yHigh }));
      const lower = [...run].reverse().map((p) => ({ x: p.x, y: p.yLow }));
      paths.push(
        `M${short(upper[0].x)},${short(upper[0].y)}${curvedSegments(upper)}` +
          ` L${short(lower[0].x)},${short(lower[0].y)}${curvedSegments(lower)} Z`,
      );
    }
    run = [];
  };
  for (const point of [...points, null]) {
    if (point) run.push(point);
    else flush();
  }
  return paths.join(" ");
}
