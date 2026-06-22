import { readFile } from "node:fs/promises";
import type {
  ProblemPattern,
  RenderStage,
  RenderPipelineGraph,
  RenderStageEdge,
} from "@cesium-nexus/shared";

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

  for (const s of stages) {
    if (s.dependsOn) {
      for (const dep of s.dependsOn) {
        if (!seenIds.has(dep)) {
          errors.push(
            `RenderStage "${s.id}": dependsOn references unknown stage "${dep}"`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `RenderStage validation failed:\n${errors.join("\n")}`,
    );
  }

  return stages;
}

export function buildRenderPipelineGraph(
  stages: RenderStage[],
): RenderPipelineGraph {
  const edges: RenderStageEdge[] = [];
  for (const stage of stages) {
    for (const depId of stage.dependsOn ?? []) {
      edges.push({ from: depId, to: stage.id, relation: "sequential" });
    }
  }
  return { stages, edges };
}

export function validatePipelineDAG(graph: RenderPipelineGraph): boolean {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const s of graph.stages) {
    inDegree.set(s.id, 0);
    adj.set(s.id, []);
  }
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited === graph.stages.length;
}

export function getStageDependencies(
  stageId: string,
  stages: RenderStage[],
): RenderStage[] {
  const map = new Map(stages.map((s) => [s.id, s]));
  const result: RenderStage[] = [];
  const visited = new Set<string>();
  const stack = [stageId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const stage = map.get(current);
    if (!stage) continue;
    for (const depId of stage.dependsOn ?? []) {
      if (!visited.has(depId)) {
        visited.add(depId);
        const dep = map.get(depId);
        if (dep) {
          result.push(dep);
          stack.push(depId);
        }
      }
    }
  }

  return result;
}

export function getDownstreamStages(
  stageId: string,
  stages: RenderStage[],
): RenderStage[] {
  const result: RenderStage[] = [];
  const visited = new Set<string>();
  const queue = [stageId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const s of stages) {
      if ((s.dependsOn ?? []).includes(current) && !visited.has(s.id)) {
        visited.add(s.id);
        result.push(s);
        queue.push(s.id);
      }
    }
  }

  return result;
}
