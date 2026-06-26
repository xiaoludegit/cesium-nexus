/**
 * Shader Intelligence CLI Commands
 *
 * Implements:
 * - cesium shader --name <name>
 * - cesium shader --type <type>
 * - cesium shader --file <file>
 * - cesium shader --related <jsSymbol>
 * - cesium shader --stage <stage>
 * - cesium shader --rebuild
 * - cesium shader --stats
 */

import type { Command } from "commander";
import { openDatabase, initSchema, SymbolRepo } from "@cesium-nexus/storage";
import {
  ShaderIndexBuilder,
  initShaderSchema,
} from "@cesium-nexus/intelligence";
import type { ShaderSymbolType } from "@cesium-nexus/intelligence";
import * as path from "node:path";
import { resolveDbPath } from "../config.js";

export function registerShaderCommand(program: Command): void {
  program
    .command("shader")
    .description("Search and manage shader symbols")
    .option("--name <pattern>", "Search by name pattern")
    .option("--type <type>", "Filter by type: uniform, varying, function, struct, define, const")
    .option("--file <pattern>", "Filter by file pattern")
    .option("--related <jsSymbol>", "Find shaders related to a JS symbol")
    .option("--stage <stage>", "Filter by render stage (model, globe, pick, etc.)")
    .option("--rebuild", "Rebuild shader index from source")
    .option("--stats", "Show shader index statistics")
    .option("--cesium-root <path>", "Path to Cesium source", "./data/cesium")
    .option("--db <path>", "SQLite database path")
    .action(
      async (opts: {
        name?: string;
        type?: string;
        file?: string;
        related?: string;
        stage?: string;
        rebuild?: boolean;
        stats?: boolean;
        cesiumRoot: string;
        db: string;
      }) => {
        const dbPath = resolveDbPath(opts.db);
        const db = openDatabase(dbPath);
        initSchema(db);
        initShaderSchema(db);

        const builder = new ShaderIndexBuilder(db);

        // Rebuild index
        if (opts.rebuild) {
          const cesiumRoot = path.resolve(opts.cesiumRoot);
          console.log(`Rebuilding shader index from ${cesiumRoot}...`);
          const index = await builder.build(cesiumRoot);
          console.log(`Shader index built with ${index.symbols.size} symbols`);
          db.close();
          return;
        }

        // Show statistics
        if (opts.stats) {
          const stats = builder.getStats();
          console.log("\nShader Index Statistics");
          console.log("─".repeat(50));
          console.log(`Total symbols: ${stats.totalSymbols}`);
          console.log("\nBy type:");
          for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`  ${type}: ${count}`);
          }
          console.log(`\nRelatable symbols: ${stats.relatableSymbols}`);
          console.log(`Related symbols: ${stats.relatedSymbols}`);
          console.log(
            `Relation success rate: ${(stats.relationSuccessRate * 100).toFixed(1)}%`
          );

          if (Object.keys(stats.byFile).length > 0) {
            console.log("\nTop files:");
            const sorted = Object.entries(stats.byFile)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10);
            for (const [file, count] of sorted) {
              console.log(`  ${file}: ${count}`);
            }
          }

          db.close();
          return;
        }

        // Check if index exists
        if (!builder.exists()) {
          console.error(
            "Shader index not built. Run: cesium shader --rebuild"
          );
          process.exit(1);
        }

        // Search by name
        if (opts.name) {
          const results = builder.searchByName(opts.name);
          if (results.length === 0) {
            console.log(`No shaders found matching "${opts.name}"`);
          } else {
            console.log(`\nFound ${results.length} shader(s):\n`);
            for (const shader of results) {
              outputShader(shader);
            }
          }
          db.close();
          return;
        }

        // Filter by type
        if (opts.type) {
          const type = opts.type as ShaderSymbolType;
          const results = builder.getByType(type);
          if (results.length === 0) {
            console.log(`No shaders found with type "${opts.type}"`);
          } else {
            console.log(`\nFound ${results.length} ${opts.type} shader(s):\n`);
            for (const shader of results) {
              outputShaderBrief(shader);
            }
          }
          db.close();
          return;
        }

        // Filter by file
        if (opts.file) {
          const results = builder.getByFile(opts.file);
          if (results.length === 0) {
            console.log(`No shaders found in files matching "${opts.file}"`);
          } else {
            console.log(`\nFound ${results.length} shader(s):\n`);
            for (const shader of results) {
              outputShaderBrief(shader);
            }
          }
          db.close();
          return;
        }

        // Find related shaders
        if (opts.related) {
          const results = builder.getByRelatedJs(opts.related);
          if (results.length === 0) {
            console.log(`No shaders found related to "${opts.related}"`);
          } else {
            console.log(
              `\nFound ${results.length} shader(s) related to ${opts.related}:\n`
            );
            for (const shader of results) {
              outputShader(shader);
            }
          }
          db.close();
          return;
        }

        // Filter by render stage
        if (opts.stage) {
          const results = builder.getByRenderStage(opts.stage);
          if (results.length === 0) {
            console.log(`No shaders found for stage "${opts.stage}"`);
          } else {
            console.log(`\nFound ${results.length} shader(s) for stage ${opts.stage}:\n`);
            for (const shader of results) {
              outputShaderBrief(shader);
            }
          }
          db.close();
          return;
        }

        // Default: show help
        console.log("Usage: cesium shader [options]");
        console.log("\nOptions:");
        console.log("  --name <pattern>      Search by name pattern");
        console.log("  --type <type>         Filter by type");
        console.log("  --file <pattern>      Filter by file pattern");
        console.log("  --related <jsSymbol>  Find related shaders");
        console.log("  --stage <stage>       Filter by render stage");
        console.log("  --rebuild             Rebuild index");
        console.log("  --stats               Show statistics");

        db.close();
      }
    );
}

function outputShader(shader: any): void {
  console.log(`  ${shader.name}`);
  console.log(`    Type: ${shader.type}`);
  console.log(`    File: ${shader.file}`);
  console.log(`    Lines: ${shader.startLine}-${shader.endLine}`);
  if (shader.relatedJsSymbols && shader.relatedJsSymbols.length > 0) {
    console.log(`    Related JS: ${shader.relatedJsSymbols.join(", ")}`);
  }
  if (shader.relatedRenderStage) {
    console.log(`    Stage: ${shader.relatedRenderStage}`);
  }
  if (shader.docComment) {
    const preview = shader.docComment.split("\n")[0].trim();
    console.log(`    Doc: ${preview}`);
  }
  console.log();
}

function outputShaderBrief(shader: any): void {
  const related =
    shader.relatedJsSymbols && shader.relatedJsSymbols.length > 0
      ? ` → ${shader.relatedJsSymbols.join(", ")}`
      : "";
  console.log(`  ${shader.name} (${shader.type})${related}`);
}
