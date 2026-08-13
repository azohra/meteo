export const STABILITY_CLASSES = [
  { className: "very-unstable", maxLapse: -3 },
  { className: "unstable", maxLapse: -2.5 },
  { className: "conditional-strong", maxLapse: -2 },
  { className: "conditional", maxLapse: -1.5 },
  { className: "near-neutral", maxLapse: -1.2 },
  { className: "stable", maxLapse: 0 },
  { className: "inverted", maxLapse: 0.5 },
  { className: "strong-inversion", maxLapse: Number.POSITIVE_INFINITY },
] as const;

export type StabilityClassName = (typeof STABILITY_CLASSES)[number]["className"];

export function stabilityClass(lapse: number): StabilityClassName {
  const match = STABILITY_CLASSES.find((entry) => lapse <= entry.maxLapse);
  return match ? match.className : "strong-inversion";
}
