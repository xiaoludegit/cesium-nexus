import type { Command } from "commander";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import { buildContextPack } from "@cesium-nexus/context-pack";
import * as path from "node:path";

export function registerContextCommand(program: Command): void {
  program
    .command("context <symbol>")
    .description("Build a Context Pack for a symbol (JSON output)")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--depth <n>", "Call graph depth", "2")
    .option("--issue-limit <n>", "Max related issues", "5")
    .option("--budget <n>", "Token budget", "5000")
    .action(
      (
        symbol: string,
        opts: {
          db: string;
          depth: string;
          issueLimit: string;
          budget: string;
        },
      ) => {
        const depth = parseInt(opts.depth, 10);
        if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
          console.error("Error: --depth must be an integer between 1 and 5");
          process.exit(1);
        }

        const issueLimit = parseInt(opts.issueLimit, 10);
        if (!Number.isInteger(issueLimit) || issueLimit < 1) {
          console.error("Error: --issue-limit must be a positive integer");
          process.exit(1);
        }

        const tokenBudget = parseInt(opts.budget, 10);
        if (!Number.isInteger(tokenBudget) || tokenBudget < 1000) {
          console.error("Error: --budget must be an integer >= 1000");
          process.exit(1);
        }

        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);

        const symbolRepo = new SymbolRepo(db);
        const issueRepo = new IssueRepo(db);
        const callGraphRepo = new CallGraphRepo(db);

        const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
          symbol,
          depth,
          issueLimit,
          tokenBudget,
        });

        if ("error" in result) {
          console.error(`Error: ${result.error}`);
          db.close();
          process.exit(1);
        }

        console.log(JSON.stringify(result, null, 2));
        db.close();
      },
    );
}
