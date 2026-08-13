// Feather values are 5, 10 and 50 km/h — NOT knots, though aviation charts
// use the same shapes for them; the printed unit is part of the symbol key.
export interface WindBarbParts {
  calm: boolean;
  pennants: number;
  fullBarbs: number;
  halfBarb: boolean;
  roundedSpeedKmh: number;
}

export function windBarbParts(speedKmh: number): WindBarbParts {
  const roundedSpeedKmh = Math.max(0, Math.round(speedKmh / 5) * 5);
  const pennants = Math.floor(roundedSpeedKmh / 50);
  const afterPennants = roundedSpeedKmh - pennants * 50;
  const fullBarbs = Math.floor(afterPennants / 10);
  return {
    calm: speedKmh < 2.5,
    fullBarbs,
    halfBarb: afterPennants - fullBarbs * 10 >= 5,
    pennants,
    roundedSpeedKmh,
  };
}

const SHAFT_TIP_Y = -20;
const SHAFT_BASE_Y = 5;
/** Distance from the barb's anchor to the farthest glyph point (the shaft tip) — the fit radius the automatic hour stride is sized from. */
export const BARB_GLYPH_RADIUS = -SHAFT_TIP_Y;
/** Full glyph height in local units (shaft tip to base), before scaling. */
export const BARB_GLYPH_HEIGHT = SHAFT_BASE_Y - SHAFT_TIP_Y;

export function windBarbPaths(speedKmh: number): { shaft: string; pennants: string[] } {
  const { pennants, fullBarbs, halfBarb } = windBarbParts(speedKmh);
  const pennantHeight = 5;
  const pennantSpacing = 7;
  const barbSpacing = 4.8;
  const pennantPaths: string[] = [];
  for (let index = 0; index < pennants; index += 1) {
    const barbY = SHAFT_TIP_Y + index * pennantSpacing;
    pennantPaths.push(
      `M0 ${round(barbY)} L9.5 ${round(barbY + pennantHeight)} L0 ${round(barbY + pennantHeight)} Z`,
    );
  }
  const featherOffset = pennants * pennantSpacing + (pennants > 0 ? 1.5 : 0);
  const featherPaths: string[] = [];
  for (let index = 0; index < fullBarbs; index += 1) {
    const barbY = SHAFT_TIP_Y + featherOffset + index * barbSpacing;
    featherPaths.push(`M0 ${round(barbY)} L8 ${round(barbY + 4.4)}`);
  }
  if (halfBarb) {
    const halfGap = pennants === 0 && fullBarbs === 0 ? 2.2 : 0;
    const barbY = SHAFT_TIP_Y + featherOffset + fullBarbs * barbSpacing + halfGap;
    featherPaths.push(`M0 ${round(barbY)} L4.5 ${round(barbY + 2.4)}`);
  }
  return {
    shaft: [`M0 ${SHAFT_BASE_Y} L0 ${SHAFT_TIP_Y}`, ...featherPaths].join(" "),
    pennants: pennantPaths,
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
