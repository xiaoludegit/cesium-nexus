import { readFile } from "node:fs/promises";
import type {
  SkillConfig,
  SkillId,
  SkillDispatchResult,
  RenderStage,
  ProblemPattern,
} from "@cesium-nexus/shared";
import type { SymbolRepo } from "@cesium-nexus/storage";
import { matchProblemPatterns } from "@cesium-nexus/diagnosis";
import { extractEntities } from "./entity-extractor.js";

const DATA_DIR = new URL("../../../data/skills/", import.meta.url);

export async function loadSkillConfigs(
  filePath?: string,
): Promise<SkillConfig[]> {
  const url = filePath
    ? new URL(filePath, import.meta.url)
    : new URL("skill-configs.json", DATA_DIR);
  const raw = await readFile(url, "utf-8");
  const configs = JSON.parse(raw) as SkillConfig[];
  return validateSkillConfigs(configs);
}

export function validateSkillConfigs(configs: SkillConfig[]): SkillConfig[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  let hasGeneral = false;

  for (const c of configs) {
    if (!c.id || c.id.trim() === "") {
      errors.push("SkillConfig has empty id");
    } else if (seenIds.has(c.id)) {
      errors.push(`Duplicate SkillConfig id: ${c.id}`);
    } else {
      seenIds.add(c.id);
    }
    if (c.id === "general") hasGeneral = true;
    if (c.tokenBudget <= 0) {
      errors.push(`SkillConfig "${c.id}": tokenBudget must be positive`);
    }
  }

  if (!hasGeneral) {
    errors.push('A "general" fallback skill must be defined');
  }

  if (errors.length > 0) {
    throw new Error(
      `SkillConfig validation failed:\n${errors.join("\n")}`,
    );
  }

  return configs;
}

export interface DispatchOptions {
  symbolRepo?: SymbolRepo;
  stages?: RenderStage[];
  patterns?: ProblemPattern[];
}

export function dispatchSkill(
  query: string,
  configs: SkillConfig[],
  options?: DispatchOptions,
): SkillDispatchResult {
  const entities = extractEntities(query, options);

  const scores = new Map<SkillId, { score: number; matchedKeywords: string[] }>();
  for (const config of configs) {
    scores.set(config.id, { score: 0, matchedKeywords: [] });
  }

  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/[\s_\-.,;:!?]+/).filter(Boolean);

  for (const config of configs) {
    const entry = scores.get(config.id)!;
    for (const kw of config.triggerKeywords) {
      if (queryLower.includes(kw.toLowerCase())) {
        entry.score += 1;
        entry.matchedKeywords.push(kw);
      }
    }
  }

  for (const entity of entities) {
    if (entity.type === "problem") {
      const debugEntry = scores.get("debug");
      if (debugEntry) {
        debugEntry.score += 2;
        debugEntry.matchedKeywords.push(`problem:${entity.value}`);
      }
    }
    if (entity.type === "stage") {
      for (const skillId of ["performance", "shader"] as SkillId[]) {
        const entry = scores.get(skillId);
        if (entry) {
          entry.score += 1;
          entry.matchedKeywords.push(`stage:${entity.value}`);
        }
      }
    }
    if (entity.type === "symbol") {
      const apiEntry = scores.get("api");
      if (apiEntry) {
        apiEntry.score += 1;
        apiEntry.matchedKeywords.push(`symbol:${entity.value}`);
      }
    }
  }

  let bestSkill: SkillId = "general";
  let bestScore = 0;
  let bestKeywords: string[] = [];

  for (const [skillId, entry] of scores) {
    if (skillId === "general") continue;
    if (entry.score > bestScore) {
      bestScore = entry.score;
      bestSkill = skillId;
      bestKeywords = entry.matchedKeywords;
    }
  }

  if (bestScore === 0) {
    bestSkill = "general";
    bestKeywords = scores.get("general")?.matchedKeywords ?? [];
  }

  const totalPossibleScore = queryTokens.length + entities.length;
  const confidence =
    totalPossibleScore > 0
      ? Math.min(bestScore / totalPossibleScore, 1.0)
      : 0;

  return {
    skill: bestSkill,
    confidence: Math.round(confidence * 100) / 100,
    matchedKeywords: bestKeywords,
    extractedEntities: entities,
  };
}
