import { createElement, type ReactNode } from "react";
import type { SceneChild, SceneNode } from "../../scene/node.js";

/* The React walker: one traversal of the scene tree every component
   renders through. Scene attributes are named the way the DOM names them;
   React spells `class` and the hyphenated SVG presentation attributes
   differently, and warns on the DOM form, so translate those. `aria-*` and
   `data-*` stay hyphenated in React too. */
function reactName(name: string): string {
  if (name === "class") return "className";
  if (name.startsWith("aria-") || name.startsWith("data-") || !name.includes("-")) return name;
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function reactProps(node: SceneNode): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (value == null || value === false) continue;
    props[reactName(name)] = value;
  }
  if (node.style !== undefined) props["style"] = node.style;
  if (node.key !== undefined) props["key"] = node.key;
  return props;
}

export function renderChild(child: SceneChild, index: number): ReactNode {
  if (child == null || child === false) return null;
  if (typeof child === "string" || typeof child === "number") return child;
  return renderScene(child, index);
}

export function renderScene(node: SceneNode, fallbackKey?: number): ReactNode {
  const props = reactProps(node);
  if (props["key"] === undefined && fallbackKey !== undefined) props["key"] = fallbackKey;
  const children = node.children ?? [];
  return children.length === 0
    ? createElement(node.tag, props)
    : createElement(node.tag, props, ...children.map(renderChild));
}

/** The scene, or nothing when the widget has no surface to draw. */
export function renderOptional(node: SceneNode | null): ReactNode {
  return node === null ? null : renderScene(node);
}

/** A run of children with no element of their own to sit in. */
export function renderChildren(children: SceneChild[]): ReactNode {
  return children.map(renderChild);
}
