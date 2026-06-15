import type { Command } from "commander";
import { openDatabase, initSchema, IssueRepo } from "@cesium-nexus/storage";
import { syncIssues, GitHubRateLimitError, GitHubApiError } from "@cesium-nexus/indexer";
import * as path from "node:path";

export function registerIssueCommands(program: Command): void {
  // Shared helper
  const getIssueRepo = (dbPath: string): { repo: IssueRepo; db: ReturnType<typeof openDatabase> } => {
    const db = openDatabase(dbPath);
    initSchema(db);
    return { repo: new IssueRepo(db), db };
  };

  // cesium sync:issues
  program
    .command("sync:issues")
    .description("Sync GitHub Issues to local database")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--owner <owner>", "GitHub repository owner", "CesiumGS")
    .option("--repo <repo>", "GitHub repository name", "cesium")
    .option("--token <token>", "GitHub personal access token (or set GITHUB_TOKEN env)")
    .option("--full", "Full sync — clear existing data and re-fetch all", false)
    .action(async (opts: {
      db: string;
      owner: string;
      repo: string;
      token?: string;
      full: boolean;
    }) => {
      const resolvedDb = path.resolve(opts.db);
      const token = opts.token ?? process.env.GITHUB_TOKEN;

      console.log(`Database: ${resolvedDb}`);
      console.log(`Repo:     ${opts.owner}/${opts.repo}`);
      console.log(`Mode:     ${opts.full ? "full sync" : "incremental"}`);
      if (!token) {
        console.log(`Auth:     none (rate limit: 60 req/h)\n`);
      } else {
        console.log(`Auth:     token provided (rate limit: 5000 req/h)\n`);
      }

      try {
        const { repo, db } = getIssueRepo(resolvedDb);

        let since: string | null = null;

        if (opts.full) {
          console.log("Clearing existing issues...");
          repo.clear();
        } else {
          since = repo.getSyncCursor();
          if (since) {
            console.log(`Incremental sync since: ${since}`);
          } else {
            console.log("No previous sync found, fetching all issues...");
          }
        }

        const result = await syncIssues({
          owner: opts.owner,
          repo: opts.repo,
          token,
          since,
        });

        console.log(`\nFiltered ${result.prsFiltered} pull requests`);
        console.log(`Fetched ${result.totalPages} pages`);

        if (result.issues.length > 0) {
          const inserted = repo.upsertMany(result.issues);
          console.log(`Upserted ${inserted} issues into database`);
        }

        // Update sync cursor
        const cursor = new Date().toISOString();
        repo.setSyncCursor(cursor);
        console.log(`Sync cursor updated: ${cursor}`);

        db.close();
      } catch (err) {
        if (err instanceof GitHubRateLimitError) {
          console.error(`\n${err.message}`);
          console.error("Provide a token: cesium sync:issues --token <token>");
          console.error("Or set GITHUB_TOKEN environment variable.");
        } else if (err instanceof GitHubApiError) {
          console.error(`\n${err.message}`);
        } else {
          console.error("Sync failed:", (err as Error).message);
        }
        process.exit(1);
      }
    });

  // cesium issue <keyword>
  program
    .command("issue <keyword...>")
    .description("Search issues by keyword (FTS5 full-text search)")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max results", "20")
    .option("--state <state>", "Filter by state (open/closed)")
    .action((keyword: string[], opts: { db: string; limit: string; state?: string }) => {
      const { repo, db } = getIssueRepo(path.resolve(opts.db));
      const limit = parseInt(opts.limit, 10);
      const state = opts.state as "open" | "closed" | undefined;

      if (state && state !== "open" && state !== "closed") {
        console.error("--state must be 'open' or 'closed'");
        process.exit(1);
      }

      const query = keyword.join(" ");
      const results = repo.searchFts(query, { limit, state });

      if (results.length === 0) {
        console.log(`No issues found for: ${query}`);
        db.close();
        return;
      }

      console.log(`\nFound ${results.length} result(s) for "${query}":\n`);

      for (const { issue, score } of results) {
        console.log(`  #${issue.number}  ${issue.title}`);
        console.log(`  state: ${issue.state}  updated: ${issue.updatedAt.slice(0, 10)}`);
        if (issue.labels.length > 0) {
          console.log(`  labels: ${issue.labels.join(", ")}`);
        }
        console.log(`  ${issue.htmlUrl}`);
        console.log("");
      }

      db.close();
    });
}
