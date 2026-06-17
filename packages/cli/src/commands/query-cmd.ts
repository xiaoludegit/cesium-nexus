import type { Command } from "commander";
import { openDatabase, initSchema, SymbolRepo } from "@cesium-nexus/storage";
import { readFileSync } from "node:fs";
import * as path from "node:path";

export function registerQueryCommands(program: Command): void {
  // Shared helper: open DB and create repo
  const getRepo = (dbPath: string): SymbolRepo => {
    const db = openDatabase(dbPath);
    initSchema(db);
    return new SymbolRepo(db);
  };

  // cesium symbol <name>
  program
    .command("symbol <name>")
    .description("Look up a symbol by name")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action((name: string, opts: { db: string }) => {
      const repo = getRepo(path.resolve(opts.db));
      const symbols = repo.findByName(name);

      if (symbols.length === 0) {
        console.log(`No symbol found: ${name}`);
        return;
      }

      // Sort: primary API file (path contains /Name.js) first, then by kind priority
      const kindPriority: Record<string, number> = { class: 0, function: 1, enum: 2, method: 3, constant: 4 };
      symbols.sort((a, b) => {
        const aPrimary = a.filePath.includes(`/${a.name}.js`) ? 0 : 1;
        const bPrimary = b.filePath.includes(`/${b.name}.js`) ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        return (kindPriority[a.kind] ?? 9) - (kindPriority[b.kind] ?? 9);
      });

      if (symbols.length > 1) {
        console.log(`Found ${symbols.length} symbols named "${name}":`);
      }

      let idx = 1;
      for (const s of symbols) {
        console.log(`\n── [${idx}] ${s.name} (${s.kind}) ──`);
        idx++;
        console.log(`  ID:       ${s.id}`);
        console.log(`  File:     ${s.filePath}`);
        console.log(`  Lines:    ${s.startLine}–${s.endLine}`);
        if (s.parentClass) console.log(`  Class:    ${s.parentClass}`);
        if (s.exports.length) console.log(`  Exports:  ${s.exports.join(", ")}`);
        if (s.imports.length) console.log(`  Imports:  ${s.imports.join(", ")}`);
        if (s.docComment) {
          const doc = s.docComment.split("\n").slice(0, 5).join("\n");
          console.log(`  Doc:      ${doc}${s.docComment.split("\n").length > 5 ? "\n            ..." : ""}`);
        }
        console.log(`  Use:      cesium source ${s.id}`);
      }
    });

  // cesium source <symbolId>
  program
    .command("source <symbolId>")
    .description("Read source code for a symbol by ID")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--cesium-root <path>", "Path to Cesium source directory", "./data/cesium")
    .option("--context <lines>", "Extra context lines before/after", "0")
    .action((symbolId: string, opts: { db: string; cesiumRoot: string; context: string }) => {
      const repo = getRepo(path.resolve(opts.db));
      const symbol = repo.findById(symbolId);

      if (!symbol) {
        console.log(`Symbol not found: ${symbolId}`);
        return;
      }

      const filePath = path.join(path.resolve(opts.cesiumRoot), symbol.filePath);
      try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const ctx = parseInt(opts.context, 10);
        const start = Math.max(0, symbol.startLine - 1 - ctx);
        const end = Math.min(lines.length, symbol.endLine + ctx);
        const _snippet = lines.slice(start, end);

        console.log(`\n── ${symbol.name} (${symbol.kind}) ──`);
        console.log(`  ${symbol.filePath}:${symbol.startLine}–${symbol.endLine}\n`);

        for (let i = start; i < end; i++) {
          const lineNum = String(i + 1).padStart(5);
          const marker = (i + 1 >= symbol.startLine && i + 1 <= symbol.endLine) ? ">" : " ";
          console.log(`${marker} ${lineNum} │ ${lines[i]}`);
        }
      } catch (err) {
        console.error(`Cannot read file: ${filePath} — ${(err as Error).message}`);
      }
    });

  // cesium search <keyword>
  program
    .command("search <keyword>")
    .description("Search source code via FTS5 full-text search")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max results", "20")
    .option("--name-only", "Search only symbol names and doc comments", false)
    .action((keyword: string, opts: { db: string; limit: string; nameOnly: boolean }) => {
      const repo = getRepo(path.resolve(opts.db));
      const limit = parseInt(opts.limit, 10);

      if (opts.nameOnly) {
        // Symbol name + doc comment search
        const results = repo.searchFts(keyword, limit);
        if (results.length === 0) {
          console.log(`No results for: ${keyword}`);
          return;
        }
        console.log(`\nFound ${results.length} result(s) for "${keyword}":\n`);
        for (const s of results) {
          const parent = s.parentClass ? ` (${s.parentClass})` : "";
          console.log(`  ${s.kind.padEnd(10)} ${s.name}${parent}`);
          console.log(`             ${s.filePath}:${s.startLine}`);
          console.log(`             Use: cesium source ${s.id}`);
        }
      } else {
        // Source code full-text search
        const results = repo.searchSource(keyword, limit);
        if (results.length === 0) {
          console.log(`No results for: ${keyword}`);
          return;
        }
        console.log(`\nFound ${results.length} result(s) for "${keyword}":\n`);
        for (const r of results) {
          console.log(`  ${r.name}`);
          console.log(`  ${r.filePath}:${r.startLine}–${r.endLine}`);
          // Format snippet: replace markers for readability
          const snippet = r.snippet
            .replace(/>>>/g, "【")
            .replace(/<<</g, "】")
            .replace(/\n/g, " ");
          console.log(`  ${snippet}`);
          console.log(`  Use: cesium source ${r.symbolId}`);
          console.log("");
        }
      }
    });
}
