"use client";
import { windArrowSpec } from "../../scene/index.js";

export function WindArrow({ deg, size = 12 }: { deg: number; size?: number }) {
  const spec = windArrowSpec(deg, size);
  return (
    <svg
      aria-hidden="true"
      className={spec.className}
      height={spec.height}
      style={{ transform: spec.transform }}
      viewBox={spec.viewBox}
      width={spec.width}
    >
      <path d={spec.path.d} fill={spec.path.fill} />
    </svg>
  );
}
