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
    .option("--since <iso>", "Only fetch issues updated since this ISO date (e.g. 2025-12-24)")
    .option("--max-pages <n>", "Stop after fetching N pages (graceful exit before rate limit)", (v: string) => parseInt(v, 10))
    .option("--full", "Full sync — clear existing data and re-fetch all", false)
    .action(async (opts: {
      db: string;
      owner: string;
      repo: string;
      token?: string;
      since?: string;
      maxPages?: number;
      full: boolean;
    }) => {
      const resolvedDb = path.resolve(opts.db);
      const token = opts.token ?? process.env.GITHUB_TOKEN;
      const repoSlug = `${opts.owner}/${opts.repo}`;

      if (opts.since && isNaN(Date.parse(opts.since))) {
        console.error(`Invalid --since value: ${opts.since} (expected ISO date)`);
        process.exit(1);
      }

      console.log(`Database: ${resolvedDb}`);
      console.log(`Repo:     ${repoSlug}`);
      console.log(`Mode:     ${opts.full ? "full sync" : "incremental"}`);
      if (opts.since) console.log(`Since:    ${opts.since}`);
      if (opts.maxPages) console.log(`Max pages: ${opts.maxPages}`);
      if (!token) {
        console.log(`Auth:     none (rate limit: 60 req/h)\n`);
      } else {
        console.log(`Auth:     token provided (rate limit: 5000 req/h)\n`);
      }

      const { repo, db } = getIssueRepo(resolvedDb);
      let inserted = 0;
      let fetchedCount = 0;
      let latestCursor: string | null = null;

      try {
        let since: string | null = opts.since ?? null;

        if (opts.full) {
          console.log(`Clearing existing issues for ${repoSlug}...`);
          repo.clear(repoSlug);
        } else if (!since) {
          since = repo.getSyncCursor(repoSlug);
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
          maxPages: opts.maxPages,
        });

        console.log(`\nFiltered ${result.prsFiltered} pull requests`);
        console.log(`Fetched ${result.totalPages} pages`);

        fetchedCount = result.issues.length;
        if (fetchedCount > 0) {
          inserted = repo.upsertMany(result.issues);
          console.log(`Upserted ${inserted} issues into database`);
        }

        latestCursor = result.maxUpdatedAt;
      } catch (err) {
        if (err instanceof GitHubRateLimitError) {
          console.error(`\n${err.message}`);
          console.error("Provide a token for larger syncs: cesium sync:issues --token <token>");
          console.error("Or set GITHUB_TOKEN environment variable.");
          console.error("Already-fetched issues will still be committed below.");
        } else if (err instanceof GitHubApiError) {
          console.error(`\n${err.message}`);
        } else {
          console.error("Sync failed:", (err as Error).message);
        }
      } finally {
        if (latestCursor) {
          repo.setSyncCursor(repoSlug, latestCursor);
          console.log(`Sync cursor updated: ${latestCursor}`);
        }
        db.close();
        console.log(`Database closed. ${inserted} issues committed.`);
        if (fetchedCount === 0 && inserted === 0) {
          console.log("No issues fetched, cursor unchanged.");
        }
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
      // Validate --limit
      const limit = parseInt(opts.limit, 10);
      if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
        console.error("--limit must be an integer between 1 and 1000");
        process.exit(1);
      }

      // Validate --state
      const state = opts.state as "open" | "closed" | undefined;
      if (state && state !== "open" && state !== "closed") {
        console.error("--state must be 'open' or 'closed'");
        process.exit(1);
      }

      const { repo, db } = getIssueRepo(path.resolve(opts.db));
      const query = keyword.join(" ");
      const results = repo.searchFts(query, { limit, state });

      if (results.length === 0) {
        console.log(`No issues found for: ${query}`);
        db.close();
        return;
      }

      console.log(`\nFound ${results.length} result(s) for "${query}":\n`);

      for (const { issue } of results) {
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
