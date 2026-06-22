import type { Command } from "commander";
import { openDatabase, initSchema, ForumRepo } from "@cesium-nexus/storage";
import { crawlForum } from "@cesium-nexus/indexer";
import * as path from "node:path";

export function registerForumCommands(program: Command): void {
  const forum = program
    .command("forum")
    .description("Cesium community forum commands");

  forum
    .command("sync")
    .description("Crawl Cesium community forum and index posts")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--base-url <url>", "Forum base URL", "https://community.cesium.com")
    .option("--max-pages <n>", "Max pages to crawl", "10")
    .option("--min-replies <n>", "Minimum replies to include", "2")
    .option("--min-views <n>", "Minimum views to include", "200")
    .action(
      async (opts: {
        db: string;
        baseUrl: string;
        maxPages: string;
        minReplies: string;
        minViews: string;
      }) => {
        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);
        const forumRepo = new ForumRepo(db);

        const result = await crawlForum({
          baseUrl: opts.baseUrl,
          maxPages: parseInt(opts.maxPages, 10),
          minReplies: parseInt(opts.minReplies, 10),
          minViews: parseInt(opts.minViews, 10),
        });

        if (result.posts.length > 0) {
          forumRepo.upsertMany(result.posts);
        }

        db.close();

        console.log(`Crawled ${result.totalPages} pages.`);
        console.log(`Indexed ${result.posts.length} posts (${result.filtered} filtered out).`);
      },
    );

  forum
    .command("search <keywords>")
    .description("Search forum posts via full-text search")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max results", "10")
    .option("--min-quality <n>", "Minimum quality score (0-1)", "0")
    .action(
      async (
        keywords: string,
        opts: { db: string; limit: string; minQuality: string },
      ) => {
        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);
        const forumRepo = new ForumRepo(db);

        const results = forumRepo.searchFts(keywords, {
          limit: parseInt(opts.limit, 10),
          minQuality: parseFloat(opts.minQuality),
        });

        db.close();

        if (results.length === 0) {
          console.log(`No forum posts found for "${keywords}".`);
          return;
        }

        console.log(`Found ${results.length} result(s) for "${keywords}":\n`);
        for (const r of results) {
          const solved = r.post.hasSolution ? "[solved]" : "";
          console.log(`  ${solved} ${r.post.title}`);
          console.log(
            `    replies: ${r.post.repliesCount}  views: ${r.post.viewsCount}  quality: ${r.post.qualityScore.toFixed(2)}`,
          );
          console.log(`    ${r.post.url}`);
        }
      },
    );
}
