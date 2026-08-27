import { SVG_ROOT_TAGS, type SceneChild, type SceneNode } from "../../scene/node.js";
import { h, hs } from "./h.js";
import type { Attrs } from "./h.js";

/* The DOM walker: one traversal of the scene tree every element renders
   through. `h`/`hs` already carry the attribute and child handling; this
   only decides the namespace and threads keys away (the DOM has no use
   for them — they exist for the React binding's lists). */
export function renderChild(child: SceneChild, svg = false): Node | string | null {
  if (child == null || child === false) return null;
  if (typeof child === "string") return child;
  if (typeof child === "number") return String(child);
  return renderScene(child, svg);
}

export function renderScene(node: SceneNode, svg = false): Element {
  const inSvg = svg || SVG_ROOT_TAGS.has(node.tag);
  const children = (node.children ?? []).map((child) => renderChild(child, inSvg));
  const element = inSvg
    ? hs(node.tag, (node.attrs ?? null) as Attrs, ...children)
    : h(node.tag, (node.attrs ?? null) as Attrs, ...children);
  if (node.style !== undefined) {
    /* Scene styles are keyed the way React spells them (camelCase, which
       CSSOM accepts as a property name); setProperty would need the
       hyphenated form and silently drops a camelCase key. */
    const style = (element as HTMLElement).style as unknown as Record<string, string>;
    for (const [property, value] of Object.entries(node.style)) {
      if (property.startsWith("--")) (element as HTMLElement).style.setProperty(property, value);
      else style[property] = value;
    }
  }
  return element;
}

/** The scene, or nothing when the widget has no surface to draw. */
export function renderOptional(node: SceneNode | null): Element[] {
  return node === null ? [] : [renderScene(node)];
}

/** A run of children with no element of their own to sit in. */
export function renderChildren(children: SceneChild[]): Array<Node | string> {
  return children
    .map((child) => renderChild(child))
    .filter((node): node is Node | string => node !== null);
}
