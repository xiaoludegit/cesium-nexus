/**
 * Init Command
 *
 * Initializes the cesium-nexus home directory and database.
 * Usage: cesium init [--db <path>]
 */

import type { Command } from "commander";
import { resolveDbPath, ensureCesiumHome, CESIUM_HOME, DEFAULT_DB_PATH } from "../config.js";
import { openDatabase, initSchema } from "@cesium-nexus/storage";
import { existsSync } from "node:fs";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize cesium-nexus home directory and database")
    .option("--db <path>", "SQLite database path")
    .option("--force", "Re-create database even if it exists", false)
    .action((opts: { db?: string; force: boolean }) => {
      const dbPath = resolveDbPath(opts.db);

      console.log(`Cesium Home: ${CESIUM_HOME}`);
      console.log(`Database:    ${dbPath}`);

      // Ensure home directory exists
      ensureCesiumHome();
      console.log(`✓ Directory ${CESIUM_HOME} ready`);

      // Check if DB already exists
      if (existsSync(dbPath) && !opts.force) {
        console.log(`\nDatabase already exists at ${dbPath}`);
        console.log("Use --force to re-create.");
        return;
      }

      // Create and initialize database
      const db = openDatabase(dbPath);
      initSchema(db);
      db.close();

      console.log(`✓ Database initialized at ${dbPath}`);
      console.log("\nNext steps:");
      console.log("  cesium index:symbols    # Index Cesium source code");
      console.log("  cesium sync:issues      # Sync GitHub issues");
      console.log("  cesium --help           # Show all commands");
    });
}
