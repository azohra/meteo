/** The explicit publisher configuration the CLI forwards into a build. */
export interface RegistryBuildOptions {
  sitesPath: string;
  outputRoot?: string;
  maxSteps?: number;
  history?: boolean;
}

/** One dispatchable build: resolves true when a run was published, false when there was nothing to do. */
export type RegisteredBuilder = (options: RegistryBuildOptions) => Promise<unknown>;

function forwardedOptions(options: RegistryBuildOptions): {
  sitesPath: string;
  outputRoot?: string;
  maxSteps?: number;
  history?: boolean;
} {
  const forwarded: {
    sitesPath: string;
    outputRoot?: string;
    maxSteps?: number;
    history?: boolean;
  } = { sitesPath: options.sitesPath };
  if (options.outputRoot !== undefined) forwarded.outputRoot = options.outputRoot;
  if (options.maxSteps !== undefined) forwarded.maxSteps = options.maxSteps;
  if (options.history !== undefined) forwarded.history = options.history;
  return forwarded;
}

/** Every dataset the packaged models.json declares, dispatchable by slug, in catalogue order. */
export const BUILDERS: ReadonlyMap<string, RegisteredBuilder> = new Map<string, RegisteredBuilder>([
  [
    "hrdps-west",
    async (options) => {
      const eccc = await import("./eccc.js");
      const west = await import("./hrdps-west.js");
      return eccc.buildEccc(west.HRDPS_WEST, forwardedOptions(options));
    },
  ],
  [
    "hrdps-continental",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.HRDPS, forwardedOptions(options));
    },
  ],
  [
    "hrrr-conus",
    async (options) => (await import("./hrrr.js")).buildHrrr(forwardedOptions(options)),
  ],
  ["rrfs", async (options) => (await import("./rrfs.js")).buildRrfs(forwardedOptions(options))],
  [
    "rdps",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.RDPS, forwardedOptions(options));
    },
  ],
  [
    "gdps",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.GDPS, forwardedOptions(options));
    },
  ],
  ["gfs", async (options) => (await import("./gfs.js")).buildGfs(forwardedOptions(options))],
  [
    "nam",
    async (options) => {
      const nam = await import("./nam.js");
      return nam.buildNam(nam.PRODUCTS["nam"]!, forwardedOptions(options));
    },
  ],
  [
    "nam-conus-nest",
    async (options) => {
      const nam = await import("./nam.js");
      return nam.buildNam(nam.PRODUCTS["nam-conus-nest"]!, forwardedOptions(options));
    },
  ],
  [
    "reps",
    async (options) => (await import("./eccc-ensemble.js")).buildReps(forwardedOptions(options)),
  ],
  [
    "geps",
    async (options) => (await import("./eccc-ensemble.js")).buildGeps(forwardedOptions(options)),
  ],
  [
    "raqdps",
    async (options) => (await import("./raqdps.js")).buildRaqdps(forwardedOptions(options)),
  ],
  [
    "goes18-dsr",
    async (options) => {
      const goes = await import("./goes.js");
      return goes.buildGoesProduct(goes.PRODUCTS["goes18-dsr"], forwardedOptions(options));
    },
  ],
  [
    "goes18-aod",
    async (options) => {
      const goes = await import("./goes.js");
      return goes.buildGoesProduct(goes.PRODUCTS["goes18-aod"], forwardedOptions(options));
    },
  ],
]);
