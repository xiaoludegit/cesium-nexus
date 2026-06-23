import type { ExperienceNode } from "@cesium-nexus/shared";
import type { ExperienceRepo } from "@cesium-nexus/storage";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { embedBatch } from "./embedding.js";
import {
  upsertExperienceEmbeddings,
  buildExperiencePayload,
  type UpsertPoint,
} from "./qdrant-client.js";
import type { EmbedExperienceResult } from "./types.js";

const BATCH_SIZE = 50;

export async function embedAllExperienceNodes(
  experienceRepo: ExperienceRepo,
  client: QdrantClient,
): Promise<EmbedExperienceResult> {
  const nodes = experienceRepo.getAll();
  if (nodes.length === 0) {
    return { totalNodes: 0, embedded: 0, skipped: 0 };
  }

  let embedded = 0;
  let skipped = 0;

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    const texts = batch.map((n) => `${n.title} ${n.summary}`);
    const embeddings = await embedBatch(texts);

    const points: UpsertPoint[] = [];
    for (let j = 0; j < batch.length; j++) {
      const node = batch[j];
      const embedding = embeddings[j];
      if (!embedding || embedding.length === 0) {
        skipped++;
        continue;
      }

      const tags = [
        ...(node.relatedSymbols ?? []),
        ...(node.tags ?? []),
      ];

      const payload = buildExperiencePayload(
        node.id,
        node.type,
        node.title,
        node.url,
        node.source,
        tags,
        node.qualityScore,
      );

      points.push({ nodeId: node.id, embedding, payload });
    }

    if (points.length > 0) {
      await upsertExperienceEmbeddings(client, points);
      embedded += points.length;
    }
  }

  return { totalNodes: nodes.length, embedded, skipped };
}

export async function embedSingleNode(
  node: ExperienceNode,
): Promise<{ embedding: number[]; text: string }> {
  const text = `${node.title} ${node.summary}`;
  const [embedding] = await embedBatch([text]);
  return { embedding, text };
}
