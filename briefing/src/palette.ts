/**
 * The shared visual identity: the one home for the hex and font values
 * the three chart themes (Meteogram `meteo-gram-*`, sounding
 * `meteo-sounding-*`, compare board `meteo-board-*`) speak in common.
 * Each theme keeps its own token FAMILY — that per-chart theming surface
 * is deliberate public API — but a shared meaning wears the same pigment
 * on every chart, and that pigment is stated once, here.
 */
export const PALETTE = {
  fontSans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  fontMono: '"IBM Plex Mono", ui-monospace, monospace',
  /** Paper — chart surface, and the halo behind text and markers. */
  surface: "#fffdf8",
  /** Recessed panel — the Meteogram's strip background, the board's lane. */
  panel: "#f2f4f1",
  /** Frame and gridline brown. */
  rule: "#776956",
  ink: "#152529",
  inkSoft: "#2f454a",
  inkMute: "#40565a",
  /** Temperature rust — also the Meteogram's accent and selection. */
  temp: "#913b0c",
  /** Usable-lift blue — also the board's thermal-window bar. */
  usable: "#2179ad",
  /** Boundary-layer-top ochre. */
  boundary: "#a46b10",
  /** Cloud-base slate — also barb halos, gust text, and the sounding's barbs. */
  cloudBase: "#355963",
  /** Rain teal. */
  rain: "#207a83",
  /** CAPE brown — the Meteogram's cape strip and the board's cap marks. */
  cap: "#8a4a08",
} as const;
