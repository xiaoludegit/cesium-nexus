import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { embedText as vectorEmbedText } from "@cesium-nexus/vector";
import type {
  EmbeddingHit,
  EmbeddingQuery,
  EmbeddingSearchProvider,
  VectorRecord,
  VectorScope,
} from "../types.js";

type ScoredPoint = Schemas["ScoredPoint"];
type ScrollResult = Awaited<ReturnType<QdrantClient["scroll"]>>;

const COLLECTION = "eng-knowledge";
const PROJECT_FILTER = "cesium-nexus";

interface QdrantEmbeddingProviderOptions {
  client: QdrantClient;
  collection?: string;
  project?: string;
}

export class QdrantEmbeddingProvider implements EmbeddingSearchProvider {
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly project: string;

  constructor(opts: QdrantEmbeddingProviderOptions) {
    this.client = opts.client;
    this.collection = opts.collection ?? COLLECTION;
    this.project = opts.project ?? PROJECT_FILTER;
  }

  async embedText(text: string): Promise<Float32Array> {
    const v = await vectorEmbedText(text);
    return Float32Array.from(v);
  }

  async search(query: EmbeddingQuery): Promise<EmbeddingHit[]> {
    let vector: number[];
    if (query.vector) {
      vector = Array.from(query.vector);
    } else if (query.text) {
      vector = await vectorEmbedText(query.text);
    } else {
      return [];
    }

    const filter = this.buildFilter(query.filter);

    const resp: ScoredPoint[] = await this.client.search(this.collection, {
      vector,
      limit: query.topK,
      score_threshold: query.minScore,
      filter,
      with_payload: true,
    });

    return resp.map((r: ScoredPoint) => ({
      id: String(r.id),
      score: r.score,
      payload: (r.payload as Record<string, unknown>) ?? {},
    }));
  }

  async listVectors(scope: VectorScope): Promise<VectorRecord[]> {
    const must: Array<Record<string, unknown>> = [
      { key: "project", match: { value: this.project } },
    ];

    const typeMap: Record<VectorScope["entityType"], string> = {
      experience: "cesium-experience",
      issue: "cesium-issue",
      pattern: "cesium-problem-pattern",
      stage: "cesium-render-stage",
    };
    must.push({ key: "nodeType", match: { value: typeMap[scope.entityType] } });

    if ("since" in scope && scope.since != null) {
      must.push({ key: "createdAt", range: { gte: scope.since } });
    }

    const records: VectorRecord[] = [];
    let offset: string | number | undefined = undefined;
    const limit = 100;

    while (true) {
      const page: ScrollResult = await this.client.scroll(this.collection, {
        limit,
        offset,
        filter: { must },
        with_vector: true,
        with_payload: true,
      });

      for (const p of page.points) {
        const vec = Array.isArray(p.vector)
          ? p.vector
          : (p.vector as Record<string, number[]> | undefined)?.[""] ?? [];
        if (vec.length === 0) continue;
        records.push({
          id: String(p.id),
          vector: Float32Array.from(vec as number[]),
          payload: (p.payload as Record<string, unknown>) ?? {},
        });
      }

      if (page.points.length < limit) break;
      const next = page.next_page_offset;
      if (next == null) break;
      if (typeof next === "string" || typeof next === "number") {
        offset = next;
      } else {
        break;
      }
    }

    return records;
  }

  private buildFilter(
    extra?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const must: Array<Record<string, unknown>> = [
      { key: "project", match: { value: this.project } },
    ];
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        must.push({ key: k, match: { value: v } });
      }
    }
    return must.length > 0 ? { must } : undefined;
  }
}
