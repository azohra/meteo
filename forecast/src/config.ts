import { accessSync, constants, mkdirSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Publisher paths or options cannot be used safely. */
export class PublisherConfigurationError extends Error {}

/** One dispatch's publisher configuration. */
export interface PublisherConfig {
  sitesPath: string;
  outputRoot: string;
  history: boolean;
  maxSteps?: number;
}

export const DEFAULT_OUTPUT_ROOT = "data";

/** Resolves a user path, expanding `~`, without requiring its final component to exist. */
export function resolvePath(path: string): string {
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return resolve(expanded);
}

function statsOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function accessible(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

export function validateSitesPath(path: string): void {
  const stats = statsOrNull(path);
  if (stats === null) {
    throw new PublisherConfigurationError(`sites file does not exist: ${path}`);
  }
  if (!stats.isFile()) {
    throw new PublisherConfigurationError(`sites path is not a file: ${path}`);
  }
  if (!accessible(path, constants.R_OK)) {
    throw new PublisherConfigurationError(`sites file is not readable: ${path}`);
  }
}

/** Validates an output root; `create: true` also creates it. */
export function prepareOutputRoot(path: string, { create }: { create: boolean }): void {
  const stats = statsOrNull(path);
  if (stats !== null) {
    if (!stats.isDirectory()) {
      throw new PublisherConfigurationError(`output path is not a directory: ${path}`);
    }
    if (!accessible(path, constants.W_OK | constants.X_OK)) {
      throw new PublisherConfigurationError(`output directory is not writable: ${path}`);
    }
    return;
  }

  let ancestor = dirname(path);
  while (statsOrNull(ancestor) === null && ancestor !== dirname(ancestor)) {
    ancestor = dirname(ancestor);
  }
  const ancestorStats = statsOrNull(ancestor);
  if (
    ancestorStats === null ||
    !ancestorStats.isDirectory() ||
    !accessible(ancestor, constants.W_OK | constants.X_OK)
  ) {
    throw new PublisherConfigurationError(
      `output directory cannot be created under ${ancestor}: ${path}`,
    );
  }
  if (!create) {
    return;
  }
  try {
    mkdirSync(path, { recursive: true });
  } catch (error) {
    throw new PublisherConfigurationError(
      `could not create output directory ${path}: ${(error as Error).message}`,
    );
  }
}
