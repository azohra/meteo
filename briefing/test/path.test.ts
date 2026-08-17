import { describe, expect, it } from "vitest";
import { curvedPath, pathYAtX, type PlotPoint } from "../src/scene/index.js";

const point = (x: number, y: number): PlotPoint => ({ x, y });

describe("pathYAtX", () => {
  it("passes through every knot the serializer draws through", () => {
    const points = [point(0, 10), point(10, 40), point(20, 20), point(30, 35)];
    for (const knot of points) {
      expect(pathYAtX(points, knot.x)).toBeCloseTo(knot.y, 6);
    }
  });

  it("reproduces a straight line exactly — Catmull-Rom is linear-precise on collinear points", () => {
    const points = [point(0, 0), point(10, 20), point(20, 40), point(30, 60)];
    for (const x of [3.5, 12.25, 17, 29.9]) {
      expect(pathYAtX(points, x)).toBeCloseTo(2 * x, 4);
    }
  });

  it("a two-point run answers with the straight segment the serializer draws", () => {
    expect(pathYAtX([point(0, 0), point(10, 30)], 5)).toBeCloseTo(15, 6);
    // The serializer agrees: two points emit an L command, not a cubic.
    expect(curvedPath([point(0, 0), point(10, 30)])).toBe("M0,0 L10,30");
  });

  it("nulls split runs like pointPath: a gap answers null, the next run still answers", () => {
    const points = [point(0, 0), point(10, 20), null, point(30, 5), point(40, 15)];
    expect(pathYAtX(points, 5)).not.toBeNull();
    expect(pathYAtX(points, 20)).toBeNull();
    expect(pathYAtX(points, 35)).toBeCloseTo(10, 6);
  });

  it("answers null outside every run and on degenerate inputs", () => {
    const points = [point(10, 5), point(20, 8)];
    expect(pathYAtX(points, 9.99)).toBeNull();
    expect(pathYAtX(points, 20.01)).toBeNull();
    expect(pathYAtX([], 5)).toBeNull();
    expect(pathYAtX([point(5, 5)], 5)).toBeNull();
  });
});
