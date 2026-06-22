import { readFile } from "node:fs/promises";
import type { ProblemPattern, RenderStage } from "@cesium-nexus/shared";

const DATA_DIR = new URL("../../../data/problem-kb/", import.meta.url);

export async function loadProblemPatterns(
  filePath?: string,
): Promise<ProblemPattern[]> {
  const url = filePath
    ? new URL(filePath, import.meta.url)
    : new URL("problem-patterns.json", DATA_DIR);
  const raw = await readFile(url, "utf-8");
  const patterns = JSON.parse(raw) as ProblemPattern[];
  return validateProblemPatterns(patterns);
}

export async function loadRenderStages(
  filePath?: string,
): Promise<RenderStage[]> {
  const url = filePath
    ? new URL(filePath, import.meta.url)
    : new URL("render-stages.json", DATA_DIR);
  const raw = await readFile(url, "utf-8");
  const stages = JSON.parse(raw) as RenderStage[];
  return validateRenderStages(stages);
}

export function validateProblemPatterns(
  patterns: ProblemPattern[],
): ProblemPattern[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const p of patterns) {
    if (!p.id || p.id.trim() === "") {
      errors.push("ProblemPattern has empty id");
    } else if (seenIds.has(p.id)) {
      errors.push(`Duplicate ProblemPattern id: ${p.id}`);
    } else {
      seenIds.add(p.id);
    }

    const requiredArrays: [string, string[]][] = [
      ["triggerKeywords", p.triggerKeywords],
      ["symptoms", p.symptoms],
      ["possibleCauses", p.possibleCauses],
      ["relatedSymbols", p.relatedSymbols],
      ["relatedStages", p.relatedStages],
      ["investigationSteps", p.investigationSteps],
      ["fixSuggestions", p.fixSuggestions],
    ];

    for (const [field, arr] of requiredArrays) {
      if (!arr || arr.length === 0) {
        errors.push(
          `ProblemPattern "${p.id}": ${field} must not be empty`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `ProblemPattern validation failed:\n${errors.join("\n")}`,
    );
  }

  return patterns;
}

export function validateRenderStages(stages: RenderStage[]): RenderStage[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const s of stages) {
    if (!s.id || s.id.trim() === "") {
      errors.push("RenderStage has empty id");
    } else if (seenIds.has(s.id)) {
      errors.push(`Duplicate RenderStage id: ${s.id}`);
    } else {
      seenIds.add(s.id);
    }

    if (!s.name || s.name.trim() === "") {
      errors.push(`RenderStage "${s.id}": name must not be empty`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `RenderStage validation failed:\n${errors.join("\n")}`,
    );
  }

  return stages;
}
