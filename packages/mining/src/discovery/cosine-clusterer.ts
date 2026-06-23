import type { Cluster, ClusterConfig, EmbeddingSearchProvider, VectorRecord } from "../types.js";

export interface ClustererOptions {
  provider: EmbeddingSearchProvider;
  config: ClusterConfig;
}

export class CosineThresholdClusterer {
  private readonly provider: EmbeddingSearchProvider;
  private readonly config: ClusterConfig;

  constructor(opts: ClustererOptions) {
    this.provider = opts.provider;
    this.config = opts.config;
  }

  async cluster(vectors: VectorRecord[]): Promise<Cluster[]> {
    if (vectors.length === 0) return [];

    const assigned = new Set<number>();
    const clusters: Cluster[] = [];
    let clusterSeq = 0;

    for (let i = 0; i < vectors.length; i++) {
      if (assigned.has(i)) continue;

      const seed = vectors[i];
      if (!seed) continue;

      const members: number[] = [i];
      assigned.add(i);

      for (let j = i + 1; j < vectors.length; j++) {
        if (assigned.has(j)) continue;
        if (members.length >= this.config.maxClusterSize) break;

        const candidate = vectors[j];
        if (!candidate) continue;

        let fitsAll = true;
        for (const m of members) {
          const mv = vectors[m];
          if (!mv) {
            fitsAll = false;
            break;
          }
          if (cosineSimilarity(mv.vector, candidate.vector) < this.config.threshold) {
            fitsAll = false;
            break;
          }
        }

        if (fitsAll) {
          members.push(j);
          assigned.add(j);
        }
      }

      if (members.length >= this.config.minClusterSize) {
        clusterSeq++;
        const memberIds = members.map((m) => vectors[m]!.id);
        clusters.push({
          id: `cluster/${clusterSeq}`,
          memberIds,
          centroid: computeCentroid(
            members.map((m) => vectors[m]!.vector),
          ),
          score: averagePairwiseCosine(members.map((m) => vectors[m]!.vector)),
        });
      }
    }

    return clusters;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

function computeCentroid(vectors: Float32Array[]): Float32Array | undefined {
  if (vectors.length === 0) return undefined;
  const dim = vectors[0]!.length;
  const out = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i] ?? 0;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    out[i] /= vectors.length;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

function averagePairwiseCosine(vectors: Float32Array[]): number {
  if (vectors.length < 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sum += cosineSimilarity(vectors[i]!, vectors[j]!);
      n++;
    }
  }
  return n === 0 ? 1 : sum / n;
}
