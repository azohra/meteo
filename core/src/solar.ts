import { degreesToRadians, radiansToDegrees } from "./angles.js";
import { normalizeDegrees } from "./angles.js";

const MILLISECONDS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1_440;

// The official event zenith: 90° plus 34′ of standard refraction plus the
// 16′ solar semi-diameter, so the events mark the upper limb at the horizon.
const OFFICIAL_ZENITH_DEGREES = 90.833;

/** Sunrise and sunset as UTC instants. */
export type SolarEvents = {
  sunrise: Date;
  sunset: Date;
};

/**
 * Sunrise and sunset for a calendar date at a site, at the official zenith
 * of 90.833°. The date key (YYYY-MM-DD, the shape `localDateKey` produces)
 * is anchored on longitude, not civil time: the result is correct wherever
 * the civil date matches the longitudinal solar date — including most of
 * the eastern hemisphere — and lands a full day off only where the
 * date-line separates the two (UTC+13/+14 zones at western longitudes). Null
 * for polar day or night, a malformed or impossible date key, or
 * out-of-range coordinates.
 */
export function solarEventsForDate(
  dateKey: string,
  latitude: number,
  longitude: number,
): SolarEvents | null {
  const date = parseDateKey(dateKey);
  if (
    !date ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const julianDay = date.getTime() / MILLISECONDS_PER_DAY + 2_440_587.5;
  const sunriseMinutes = eventMinutesUtc(julianDay, latitude, longitude, true);
  const sunsetMinutes = eventMinutesUtc(julianDay, latitude, longitude, false);
  if (sunriseMinutes == null || sunsetMinutes == null) return null;

  return {
    sunrise: new Date(date.getTime() + sunriseMinutes * 60_000),
    sunset: new Date(date.getTime() + sunsetMinutes * 60_000),
  };
}

// Two passes: the first evaluates the sun at local solar noon, the second
// re-evaluates it at the first pass's answer, so declination and the
// equation of time are taken at the event itself.
function eventMinutesUtc(julianDay: number, latitude: number, longitude: number, sunrise: boolean) {
  const firstPass = calculateEventMinutes(julianDay, latitude, longitude, sunrise);
  if (firstPass == null) return null;
  return calculateEventMinutes(
    julianDay + firstPass / MINUTES_PER_DAY,
    latitude,
    longitude,
    sunrise,
  );
}

function calculateEventMinutes(
  julianDay: number,
  latitude: number,
  longitude: number,
  sunrise: boolean,
) {
  const julianCentury = (julianDay - 2_451_545) / 36_525;
  const solarDeclination = sunDeclination(julianCentury);
  const latitudeRadians = degreesToRadians(latitude);
  const declinationRadians = degreesToRadians(solarDeclination);
  const hourAngleCosine =
    Math.cos(degreesToRadians(OFFICIAL_ZENITH_DEGREES)) /
      (Math.cos(latitudeRadians) * Math.cos(declinationRadians)) -
    Math.tan(latitudeRadians) * Math.tan(declinationRadians);
  if (hourAngleCosine < -1 || hourAngleCosine > 1) return null;

  const hourAngleDegrees = radiansToDegrees(Math.acos(hourAngleCosine)) * (sunrise ? 1 : -1);
  return 720 - 4 * (longitude + hourAngleDegrees) - equationOfTimeMinutes(julianCentury);
}

// Meeus polynomials here, not a Spencer Fourier series: Spencer is the
// cheap bulk per-hour form for transmittance ratios, where a quarter degree
// of declination is invisible; at the horizon crossing the same error moves
// a displayed event time by minutes.
function equationOfTimeMinutes(julianCentury: number) {
  const obliquityRadians = degreesToRadians(correctedObliquity(julianCentury));
  const solarLongitudeRadians = degreesToRadians(geometricMeanLongitude(julianCentury));
  const solarAnomalyRadians = degreesToRadians(geometricMeanAnomaly(julianCentury));
  const eccentricity = earthOrbitEccentricity(julianCentury);
  const y = Math.tan(obliquityRadians / 2) ** 2;
  const equation =
    y * Math.sin(2 * solarLongitudeRadians) -
    2 * eccentricity * Math.sin(solarAnomalyRadians) +
    4 * eccentricity * y * Math.sin(solarAnomalyRadians) * Math.cos(2 * solarLongitudeRadians) -
    0.5 * y ** 2 * Math.sin(4 * solarLongitudeRadians) -
    1.25 * eccentricity ** 2 * Math.sin(2 * solarAnomalyRadians);
  return 4 * radiansToDegrees(equation);
}

function sunDeclination(julianCentury: number) {
  const obliquityRadians = degreesToRadians(correctedObliquity(julianCentury));
  const apparentLongitudeRadians = degreesToRadians(apparentSolarLongitude(julianCentury));
  return radiansToDegrees(
    Math.asin(Math.sin(obliquityRadians) * Math.sin(apparentLongitudeRadians)),
  );
}

function apparentSolarLongitude(julianCentury: number) {
  const omega = 125.04 - 1934.136 * julianCentury;
  return trueSolarLongitude(julianCentury) - 0.00569 - 0.00478 * Math.sin(degreesToRadians(omega));
}

function trueSolarLongitude(julianCentury: number) {
  return geometricMeanLongitude(julianCentury) + sunEquationOfCentre(julianCentury);
}

function sunEquationOfCentre(julianCentury: number) {
  const anomalyRadians = degreesToRadians(geometricMeanAnomaly(julianCentury));
  return (
    Math.sin(anomalyRadians) * (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury)) +
    Math.sin(2 * anomalyRadians) * (0.019993 - 0.000101 * julianCentury) +
    Math.sin(3 * anomalyRadians) * 0.000289
  );
}

function correctedObliquity(julianCentury: number) {
  const omega = 125.04 - 1934.136 * julianCentury;
  return meanObliquity(julianCentury) + 0.00256 * Math.cos(degreesToRadians(omega));
}

function meanObliquity(julianCentury: number) {
  const seconds =
    21.448 - julianCentury * (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813));
  return 23 + (26 + seconds / 60) / 60;
}

function earthOrbitEccentricity(julianCentury: number) {
  return 0.016708634 - julianCentury * (0.000042037 + 0.0000001267 * julianCentury);
}

function geometricMeanAnomaly(julianCentury: number) {
  return 357.52911 + julianCentury * (35_999.05029 - 0.0001537 * julianCentury);
}

function geometricMeanLongitude(julianCentury: number) {
  return normalizeDegrees(280.46646 + julianCentury * (36_000.76983 + 0.0003032 * julianCentury));
}

function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}
