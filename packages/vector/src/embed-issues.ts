import type { IssueRecord } from "@cesium-nexus/shared";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { embedBatch } from "./embedding.js";
import {
  nodeIdToQdrantId,
  upsertPoints,
  type GenericUpsertPoint,
} from "./qdrant-client.js";

const BATCH_SIZE = 50;

export interface QdrantIssuePayload {
  type: "cesium-issue";
  project: "cesium-nexus";
  tags: string[];
  importance: number;
  status: string;
  node_id: string;
  node_type: "github-issue";
  title: string;
  url: string;
  repo: string;
  issue_number: number;
  state: string;
  created_at: string;
  updated_at: string;
}

export function buildIssueEmbedText(issue: IssueRecord): string {
  const labels = issue.labels.length ? `Labels: ${issue.labels.join(", ")}. ` : "";
  const body = (issue.body ?? "").replace(/\s+/g, " ").slice(0, 1500);
  return `${issue.title}. ${labels}${body}`;
}

export function buildIssuePayload(issue: IssueRecord): QdrantIssuePayload {
  return {
    type: "cesium-issue",
    project: "cesium-nexus",
    tags: issue.labels.slice(),
    importance: 0.5,
    status: issue.state ?? "unknown",
    node_id: `github-issue/${issue.number}`,
    node_type: "github-issue",
    title: issue.title,
    url: issue.htmlUrl,
    repo: issue.repo,
    issue_number: issue.number,
    state: issue.state ?? "unknown",
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
  };
}

export interface EmbedIssuesOptions {
  since?: string;
  limit?: number;
}

export interface EmbedIssuesResult {
  totalIssues: number;
  embedded: number;
  skipped: number;
  since?: string;
}

export async function embedIssues(
  issues: IssueRecord[],
  client: QdrantClient,
): Promise<EmbedIssuesResult> {
  if (issues.length === 0) {
    return { totalIssues: 0, embedded: 0, skipped: 0 };
  }

  let embedded = 0;
  let skipped = 0;

  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildIssueEmbedText);

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(texts);
    } catch (err) {
      console.error(`embedBatch failed on batch of ${batch.length}:`, (err as Error).message);
      skipped += batch.length;
      continue;
    }

    const points: GenericUpsertPoint[] = [];
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      if (!embedding || embedding.length === 0) {
        skipped++;
        continue;
      }
      const issue = batch[j]!;
      points.push({
        id: nodeIdToQdrantId(`github-issue/${issue.number}`),
        embedding,
        payload: buildIssuePayload(issue) as unknown as Record<string, unknown>,
      });
    }

    if (points.length > 0) {
      try {
        await upsertPoints(client, points);
        embedded += points.length;
      } catch (err) {
        const e = err as Error;
        console.error(
          `Qdrant upsert failed on batch of ${points.length}: ${e.message}\n  sample id=${points[0]!.id}\n  sample payload keys=${Object.keys(points[0]!.payload).join(",")}\n  sample embedding dim=${points[0]!.embedding.length}`,
        );
        skipped += points.length;
      }
    }
  }

  return { totalIssues: issues.length, embedded, skipped };
}
