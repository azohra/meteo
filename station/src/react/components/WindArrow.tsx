"use client";
import { windArrowNode } from "../../scene/index.js";
import { renderScene } from "./SceneTree.js";

export function WindArrow({ deg, size = 12 }: { deg: number; size?: number }) {
  return renderScene(windArrowNode(deg, size));
}
