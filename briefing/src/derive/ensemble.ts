import { isEnsembleValue, type Scalar } from "../contract.js";

/**
 * Selects the median from a Scalar: plain numbers pass through, ensemble
 * values yield their p50, null and undefined pass through as null — and a
 * full-dropout ensemble position has no median, so its p50 is null too.
 */
export function p50(value: Scalar | null | undefined): number | null {
  if (value == null) return null;
  return isEnsembleValue(value) ? value.p50 : value;
}
