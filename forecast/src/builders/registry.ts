/** The explicit publisher configuration the CLI forwards into a build. */
export interface RegistryBuildOptions {
  sitesPath: string;
  outputRoot?: string;
  maxSteps?: number;
  history?: boolean;
}

/** One dispatchable build: resolves true when a run was published, false when there was nothing to do. */
export type RegisteredBuilder = (options: RegistryBuildOptions) => Promise<unknown>;

function forecastOptions(options: RegistryBuildOptions): {
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

function observationOptions(options: RegistryBuildOptions): {
  sitesPath: string;
  outputRoot?: string;
  history?: boolean;
} {
  const forwarded: { sitesPath: string; outputRoot?: string; history?: boolean } = {
    sitesPath: options.sitesPath,
  };
  if (options.outputRoot !== undefined) forwarded.outputRoot = options.outputRoot;
  if (options.history !== undefined) forwarded.history = options.history;
  return forwarded;
}

/** Every dataset the packaged models.json declares, dispatchable by slug, in catalogue order. */
export const BUILDERS: ReadonlyMap<string, RegisteredBuilder> = new Map<string, RegisteredBuilder>([
  [
    "hrdps-west",
    async (options) => (await import("./hrdps-west.js")).buildHrdpsWest(forecastOptions(options)),
  ],
  [
    "hrdps-continental",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.HRDPS, forecastOptions(options));
    },
  ],
  [
    "hrrr-conus",
    async (options) => (await import("./hrrr.js")).buildHrrr(forecastOptions(options)),
  ],
  [
    "rdps",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.RDPS, forecastOptions(options));
    },
  ],
  [
    "gdps",
    async (options) => {
      const eccc = await import("./eccc.js");
      return eccc.buildEccc(eccc.GDPS, forecastOptions(options));
    },
  ],
  ["gfs", async (options) => (await import("./gfs.js")).buildGfs(forecastOptions(options))],
  [
    "nam",
    async (options) => {
      const nam = await import("./nam.js");
      return nam.buildNam(nam.PRODUCTS["nam"]!, forecastOptions(options));
    },
  ],
  [
    "nam-conus-nest",
    async (options) => {
      const nam = await import("./nam.js");
      return nam.buildNam(nam.PRODUCTS["nam-conus-nest"]!, forecastOptions(options));
    },
  ],
  ["reps", async (options) => (await import("./reps.js")).buildReps(forecastOptions(options))],
  ["geps", async (options) => (await import("./geps.js")).buildGeps(forecastOptions(options))],
  [
    "raqdps",
    async (options) => (await import("./raqdps.js")).buildRaqdps(forecastOptions(options)),
  ],
  [
    "goes18-dsr",
    async (options) => {
      const goes = await import("./goes.js");
      return goes.buildGoesProduct(goes.PRODUCTS["goes18-dsr"], observationOptions(options));
    },
  ],
  [
    "goes18-aod",
    async (options) => {
      const goes = await import("./goes.js");
      return goes.buildGoesProduct(goes.PRODUCTS["goes18-aod"], observationOptions(options));
    },
  ],
]);
