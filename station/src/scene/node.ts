/* The renderer-independent element tree every scene builder emits. Both
   display bindings walk this shape rather than decoding a bespoke record
   per widget: the React tree and the custom-element DOM come out of one
   description, so they cannot drift.

   Attribute names are the DOM's own (`class`, `aria-label`, `stroke-width`);
   the React walker translates the one name React spells differently.
   Handlers are named React-style (`onClick`); the DOM walker lowercases
   them into `addEventListener`. */
export type SceneAttrValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((event: never) => void);

export interface SceneNode {
  tag: string;
  attrs?: Record<string, SceneAttrValue>;
  /** Inline styles, for the few placements a stylesheet cannot reach. */
  style?: Record<string, string>;
  /** List identity, required only where a builder emits siblings from data. */
  key?: string;
  children?: SceneChild[];
}

export type SceneChild = SceneNode | string | number | null | false | undefined;

/** An element node; children may be nested arrays and are flattened by the walkers. */
export function el(
  tag: string,
  attrs?: Record<string, SceneAttrValue>,
  ...children: (SceneChild | SceneChild[])[]
): SceneNode {
  const node: SceneNode = { tag };
  if (attrs !== undefined) node.attrs = attrs;
  if (children.length > 0) node.children = children.flat();
  return node;
}

/** The same, carrying list identity. */
export function keyed(
  key: string,
  tag: string,
  attrs?: Record<string, SceneAttrValue>,
  ...children: (SceneChild | SceneChild[])[]
): SceneNode {
  return { ...el(tag, attrs, ...children), key };
}

/** Tags that open an SVG subtree; everything inside one stays in that namespace. */
export const SVG_ROOT_TAGS = new Set(["svg"]);
