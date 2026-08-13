/* The Meteogram tier's one published surface: the renderer-independent
   scene graph and the SVG serializer, together. The internal split
   (src/scene, src/svg) stays — this module curates it — so a future
   chart family arrives as its own subpath beside this one instead of
   forcing either to move. */
export * from "./scene/index.js";
export * from "./svg/index.js";
