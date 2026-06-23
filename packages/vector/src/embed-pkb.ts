import type { ProblemPattern, RenderStage } from "@cesium-nexus/shared";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { embedBatch } from "./embedding.js";
import {
  buildProblemPatternPayload,
  buildRenderStagePayload,
  upsertPoints,
  type GenericUpsertPoint,
} from "./qdrant-client.js";
import type { EmbedPKBResult } from "./types.js";

const BATCH_SIZE = 50;

export function buildPatternEmbedText(p: ProblemPattern): string {
  const symptoms = p.symptoms.join(". ");
  const keywords = p.triggerKeywords.join(", ");
  return `${p.name}. Symptoms: ${symptoms}. Keywords: ${keywords}`;
}

export function buildStageEmbedText(s: RenderStage): string {
  const hints = s.symptomHints.join(", ");
  return `${s.name}. ${s.description} Symptom hints: ${hints}`;
}

export async function embedProblemPatterns(
  patterns: ProblemPattern[],
  client: QdrantClient,
): Promise<{ totalPatterns: number }> {
  if (patterns.length === 0) {
    return { totalPatterns: 0 };
  }

  for (let i = 0; i < patterns.length; i += BATCH_SIZE) {
    const batch = patterns.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildPatternEmbedText);
    const embeddings = await embedBatch(texts);

    const points: GenericUpsertPoint[] = [];
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      if (!embedding || embedding.length === 0) continue;

      points.push({
        id: `pkb:${batch[j].id}`,
        embedding,
        payload: buildProblemPatternPayload(batch[j]) as unknown as Record<string, unknown>,
      });
    }

    if (points.length > 0) {
      await upsertPoints(client, points);
    }
  }

  return { totalPatterns: patterns.length };
}

export async function embedRenderStages(
  stages: RenderStage[],
  client: QdrantClient,
): Promise<{ totalStages: number }> {
  if (stages.length === 0) {
    return { totalStages: 0 };
  }

  for (let i = 0; i < stages.length; i += BATCH_SIZE) {
    const batch = stages.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildStageEmbedText);
    const embeddings = await embedBatch(texts);

    const points: GenericUpsertPoint[] = [];
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      if (!embedding || embedding.length === 0) continue;

      points.push({
        id: `stage:${batch[j].id}`,
        embedding,
        payload: buildRenderStagePayload(batch[j]) as unknown as Record<string, unknown>,
      });
    }

    if (points.length > 0) {
      await upsertPoints(client, points);
    }
  }

  return { totalStages: stages.length };
}

export async function embedAllPKB(
  patterns: ProblemPattern[],
  stages: RenderStage[],
  client: QdrantClient,
): Promise<EmbedPKBResult> {
  const { totalPatterns } = await embedProblemPatterns(patterns, client);
  const { totalStages } = await embedRenderStages(stages, client);
  return { totalPatterns, totalStages };
}
