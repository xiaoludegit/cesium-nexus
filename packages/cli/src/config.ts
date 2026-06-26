/**
 * Shared CLI configuration
 *
 * Resolves paths for database, data files, etc.
 * Priority: CLI --db flag > CESIUM_DB env > CESIUM_HOME env > ~/.cesium-nexus/
 */

import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/** Default cesium home directory */
export const CESIUM_HOME = process.env.CESIUM_HOME || join(homedir(), ".cesium-nexus");

/** Default database path */
export const DEFAULT_DB_PATH = process.env.CESIUM_DB || join(CESIUM_HOME, "cesium.db");

/**
 * Resolve database path.
 * - If --db is provided and absolute, use it directly.
 * - If --db is relative, resolve against CESIUM_HOME (not cwd).
 * - Otherwise use DEFAULT_DB_PATH.
 */
export function resolveDbPath(flagValue?: string): string {
  if (flagValue) {
    return isAbsolute(flagValue) ? flagValue : resolve(CESIUM_HOME, flagValue);
  }
  return DEFAULT_DB_PATH;
}

/**
 * Ensure CESIUM_HOME directory exists.
 */
export function ensureCesiumHome(): void {
  if (!existsSync(CESIUM_HOME)) {
    mkdirSync(CESIUM_HOME, { recursive: true });
  }
}

/**
 * Find the project root (for data files like problem-patterns.json).
 * Walks up from this file's location to find pnpm-workspace.yaml.
 */
export function findProjectRoot(): string | null {
  let dir = import.meta.dirname;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return null;
}
