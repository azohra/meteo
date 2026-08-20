import type { Grid, LambertGrid, LatLonGrid, RotatedLatLonGrid } from "./grid.js";
import { fromRotated, greatCircleDistanceKm, toRadians, toDegrees, toRotated } from "./sphere.js";

export interface NearestGridpoint {
  /** Index into the full decoded values array (storage order). */
  index: number;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

/* GRIB2 scanning modes (flag table 3.4): storage is row-major unless j
 * points are consecutive (column-major), and alternative row scanning
 * stores every second run reversed — boustrophedon order. */
function storageIndex(grid: Grid, column: number, row: number): number {
  if (grid.jPointsAreConsecutive) {
    if (grid.alternativeRowScanning) {
      return column * grid.nj + (column % 2 === 1 ? grid.nj - 1 - row : row);
    }
    return column * grid.nj + row;
  }
  if (grid.alternativeRowScanning) {
    return row * grid.ni + (row % 2 === 1 ? grid.ni - 1 - column : column);
  }
  return row * grid.ni + column;
}

function normalize360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Candidate integer coordinates around a fractional position; outside a
 * non-wrapping axis both extremes compete, and distance decides. */
function candidates(fractional: number, count: number, wraps: boolean): number[] {
  const low = Math.floor(fractional);
  const picks = new Set<number>();
  for (const candidate of [low, low + 1]) {
    if (wraps) {
      picks.add(((candidate % count) + count) % count);
    } else {
      picks.add(clamp(candidate, 0, count - 1));
    }
  }
  if (!wraps && (fractional < 0 || fractional > count - 1)) {
    picks.add(0);
    picks.add(count - 1);
  }
  return [...picks];
}

interface PlaneGeometry {
  fractionalColumn: number;
  fractionalRow: number;
  iWraps: boolean;
  coordsAt(c: number, r: number): { latitude: number; longitude: number };
}

function latLonGeometry(
  grid: LatLonGrid | RotatedLatLonGrid,
  latitude: number,
  longitude: number,
): PlaneGeometry {
  const rotated = grid.kind === "rotated";
  if (rotated && grid.angleOfRotation !== 0) {
    throw new Error(
      `rotated grid has angleOfRotation=${grid.angleOfRotation}; only 0 is supported ` +
        "(no observed ECCC product rotates, and ignoring the angle would geolocate every point wrong)",
    );
  }
  const query = rotated
    ? toRotated(latitude, longitude, grid.southPoleLatitude, grid.southPoleLongitude)
    : { latitude, longitude };

  const la1 = grid.latitudeOfFirstGridPoint;
  const lo1 = grid.longitudeOfFirstGridPoint;
  const latStep = grid.jScansPositively ? grid.jDirectionIncrement : -grid.jDirectionIncrement;
  const iSign = grid.iScansNegatively ? -1 : 1;

  const fractionalRow = (query.latitude - la1) / latStep;
  const fractionalColumn = normalize360((query.longitude - lo1) * iSign) / grid.iDirectionIncrement;
  const iWraps = grid.ni * grid.iDirectionIncrement >= 360 - grid.iDirectionIncrement * 0.5;

  return {
    fractionalColumn,
    fractionalRow,
    iWraps,
    coordsAt(c, r) {
      const pointLat = la1 + r * latStep;
      const pointLon = lo1 + c * grid.iDirectionIncrement * iSign;
      if (rotated) {
        return fromRotated(pointLat, pointLon, grid.southPoleLatitude, grid.southPoleLongitude);
      }
      return { latitude: pointLat, longitude: normalize360(pointLon) };
    },
  };
}

function lambertGeometry(grid: LambertGrid, latitude: number, longitude: number): PlaneGeometry {
  if ((grid.projectionCentreFlag & 0xc0) !== 0) {
    throw new Error(
      `Lambert projectionCentreFlag=${grid.projectionCentreFlag} is not supported ` +
        "(north-pole, single-projection grids only — HRRR and NAM)",
    );
  }
  const radius = grid.earthRadiusM;
  const phi1 = toRadians(grid.latin1);
  const phi2 = toRadians(grid.latin2);
  const lambda0 = toRadians(grid.loV);
  /* Spherical Lambert conformal conic, north-pole aspect (Snyder 1987,
   * eqs. 15-1..15-5). With coincident standard parallels the n ratio is
   * 0/0; the tangent-cone value is sin(phi1). */
  const n =
    grid.latin1 === grid.latin2
      ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2)) /
        Math.log(Math.tan(Math.PI / 4 + phi2 / 2) / Math.tan(Math.PI / 4 + phi1 / 2));
  const f = (Math.cos(phi1) * Math.tan(Math.PI / 4 + phi1 / 2) ** n) / n;
  const rho = (lat: number) => (radius * f) / Math.tan(Math.PI / 4 + toRadians(lat) / 2) ** n;
  const rho0 = rho(grid.laD);

  const forward = (lat: number, lon: number): { x: number; y: number } => {
    let dLambda = toRadians(lon) - lambda0;
    // wrapped to [-PI, PI) so a query across the antimeridian stays local
    dLambda = ((((dLambda + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const theta = n * dLambda;
    const r = rho(lat);
    return { x: r * Math.sin(theta), y: rho0 - r * Math.cos(theta) };
  };
  const inverse = (x: number, y: number): { latitude: number; longitude: number } => {
    const r = Math.hypot(x, rho0 - y);
    const theta = Math.atan2(x, rho0 - y);
    const lat = 2 * Math.atan(((radius * f) / r) ** (1 / n)) - Math.PI / 2;
    return {
      latitude: toDegrees(lat),
      longitude: normalize360(toDegrees(lambda0 + theta / n)),
    };
  };

  const first = forward(grid.latitudeOfFirstGridPoint, grid.longitudeOfFirstGridPoint);
  const stepX = grid.iScansNegatively ? -grid.dxM : grid.dxM;
  const stepY = grid.jScansPositively ? grid.dyM : -grid.dyM;
  const query = forward(latitude, longitude);

  return {
    fractionalColumn: (query.x - first.x) / stepX,
    fractionalRow: (query.y - first.y) / stepY,
    iWraps: false,
    coordsAt: (c, r) => inverse(first.x + c * stepX, first.y + r * stepY),
  };
}

/**
 * The nearest gridpoint to a geographic point, O(1) per call: the analytic
 * inverse names the candidate cell, and the surrounding gridpoints are
 * compared by great-circle distance. Never throws for out-of-domain points
 * — the reported distance is the caller's domain guard.
 */
export function nearestGridpoint(
  grid: Grid,
  latitude: number,
  longitude: number,
): NearestGridpoint {
  const geometry =
    grid.kind === "lambert"
      ? lambertGeometry(grid, latitude, longitude)
      : latLonGeometry(grid, latitude, longitude);

  const radiusKm = grid.earthRadiusM / 1000;
  const columnCandidates = candidates(geometry.fractionalColumn, grid.ni, geometry.iWraps);
  const rowCandidates = candidates(geometry.fractionalRow, grid.nj, false);

  let best: NearestGridpoint | undefined;
  for (const r of rowCandidates) {
    for (const c of columnCandidates) {
      const point = geometry.coordsAt(c, r);
      const distanceKm = greatCircleDistanceKm(
        radiusKm,
        latitude,
        longitude,
        point.latitude,
        point.longitude,
      );
      if (best === undefined || distanceKm < best.distanceKm) {
        best = {
          index: storageIndex(grid, c, r),
          latitude: point.latitude,
          longitude: point.longitude,
          distanceKm,
        };
      }
    }
  }
  /* istanbul ignore next -- candidates() always yields at least one cell */
  if (best === undefined) throw new Error("grid has no points");
  return best;
}
