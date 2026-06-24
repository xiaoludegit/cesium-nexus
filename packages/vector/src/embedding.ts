import type { FeatureExtractionPipeline } from "@xenova/transformers";

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let _extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!_extractor) {
    const mod = await import("@xenova/transformers");
    const endpoint = process.env.HF_ENDPOINT?.trim();
    if (endpoint) {
      mod.env.remoteHost = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
    }
    _extractor = await mod.pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return _extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data) as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const results: number[][] = [];
  for (const text of texts) {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    results.push(Array.from(output.data) as number[]);
  }
  return results;
}

export const EMBEDDING_DIM = 384;
