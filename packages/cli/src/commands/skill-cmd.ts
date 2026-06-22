import type { Command } from "commander";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  CallGraphRepo,
  IssueRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
} from "@cesium-nexus/storage";
import {
  loadSkillConfigs,
  dispatchSkill,
  buildSkillContextPack,
} from "@cesium-nexus/skills";
import { loadProblemPatterns, loadRenderStages } from "@cesium-nexus/diagnosis";
import * as path from "node:path";

export function registerSkillCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("Skill dispatch commands");

  skills
    .command("list")
    .description("List all available skills and their configurations")
    .action(async () => {
      const configs = await loadSkillConfigs();
      console.log("id / name / token budget / sections\n");
      for (const c of configs) {
        console.log(`${c.id} | ${c.name} | budget: ${c.tokenBudget}`);
        console.log(`  sections: ${c.sections.join(", ")}`);
        console.log(
          `  triggers: ${c.triggerKeywords.length > 0 ? c.triggerKeywords.slice(0, 5).join(", ") + (c.triggerKeywords.length > 5 ? "..." : "") : "(fallback)"}`,
        );
      }
    });

  program
    .command("dispatch <query>")
    .description("Show which skill a query would be dispatched to")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action(async (query: string, opts: { db: string }) => {
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);
      const symbolRepo = new SymbolRepo(db);

      const configs = await loadSkillConfigs();
      const patterns = await loadProblemPatterns();
      const stages = await loadRenderStages();

      const result = dispatchSkill(query, configs, {
        symbolRepo,
        stages,
        patterns,
      });

      db.close();

      console.log(`\n=== Skill Dispatch: "${query}" ===\n`);
      console.log(`Skill: ${result.skill} (confidence: ${result.confidence})`);
      if (result.matchedKeywords.length > 0) {
        console.log(`Matched: ${result.matchedKeywords.join(", ")}`);
      }
      if (result.extractedEntities.length > 0) {
        console.log("Entities:");
        for (const e of result.extractedEntities) {
          console.log(`  ${e.type}: ${e.value}`);
        }
      }
    });

  program
    .command("skill-pack <query>")
    .description("Build a skill-aware Context Pack v2")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--budget <n>", "Token budget", "6000")
    .action(async (query: string, opts: { db: string; budget: string }) => {
      const budget = parseInt(opts.budget, 10);
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);

      const symbolRepo = new SymbolRepo(db);
      const callGraphRepo = new CallGraphRepo(db);
      const issueRepo = new IssueRepo(db);
      const prRepo = new PullRequestRepo(db);
      const forumRepo = new ForumRepo(db);
      const experienceRepo = new ExperienceRepo(db);

      const configs = await loadSkillConfigs();
      const patterns = await loadProblemPatterns();
      const stages = await loadRenderStages();

      const result = await buildSkillContextPack({
        query,
        symbolRepo,
        callGraphRepo,
        issueRepo,
        prRepo,
        forumRepo,
        experienceRepo,
        patterns,
        stages,
        configs,
        budget,
      });

      db.close();

      console.log(`\n=== Skill Pack: "${query}" ===\n`);
      console.log(`Skill: ${result.skill}`);
      console.log(`Sections: ${result.metadata.sectionsIncluded.join(", ")}`);

      if (result.symbol) {
        console.log(`\nSymbol: ${result.symbol.name} (${result.symbol.kind})`);
      }
      if (result.source.length > 0) {
        console.log(`Source: ${result.source.length} snippet(s)`);
      }
      if (result.callgraph.length > 0) {
        console.log(`Callgraph: ${result.callgraph.length} edge(s)`);
      }
      if (result.issues.length > 0) {
        console.log(`Issues: ${result.issues.length}`);
      }
      if (result.renderStages && result.renderStages.length > 0) {
        console.log(`Render Stages: ${result.renderStages.map((s) => s.id).join(", ")}`);
      }
      if (result.forum && result.forum.length > 0) {
        console.log(`Forum: ${result.forum.length} post(s)`);
      }
      if (result.experience && result.experience.length > 0) {
        console.log(`Experience: ${result.experience.length} node(s)`);
      }

      console.log(
        `\n[metadata] tokens: ${result.metadata.totalTokens}/${result.metadata.tokenBudget}, truncated: ${result.metadata.truncated}`,
      );
    });
}
