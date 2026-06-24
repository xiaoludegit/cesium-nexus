/**
 * Drafter — turns a Cluster + CanonicalProblem into a NewCandidateInput
 * by asking the LLM to generate a structured pattern draft.
 *
 * Prompt template is a TypeScript string constant (no YAML/JSON config yet).
 */

import type { CanonicalProblem, Cluster } from "../types.js";
import type { LLMBackend } from "../drafting/llm-backend.js";
import type { NewCandidateInput } from "../drafting/candidate-factory.js";

export interface DrafterOptions {
  llm: LLMBackend;
  /** Optional system prompt override (default included) */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a CesiumJS expert analyst. Your job is to synthesize a cluster of related Cesium issues/discussions into a structured "problem pattern" candidate.

Given a cluster of issues and a canonical problem summary, produce a concise, actionable pattern definition that can be used for automated diagnosis.

Return ONLY valid JSON — no markdown fences, no explanation text.`;

const DRAFTER_USER_TEMPLATE = (
  canonical: CanonicalProblem,
  cluster: Cluster,
  memberSummaries: string[],
): string => `## Canonical Problem
Title: ${canonical.title || "(unnamed)"}
Confidence: ${canonical.confidence.toFixed(2)}
Aliases: ${(canonical.aliases ?? []).join(", ") || "(none)"}

## Cluster Members (${cluster.memberIds.length} items)
${memberSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Task
Produce a JSON object with these fields:
- "draftAlias": 3-8 short aliases/keywords for this problem (lowercase, hyphenated)
- "draftSymptoms": 2-5 symptom descriptions (what users report)
- "draftSymbols": 3-8 Cesium class/function names involved
- "draftCategory": one of "debug", "performance", "rendering", "terrain", "tiles", "shader"

Example output:
{
  "draftAlias": ["z-fighting", "polygon flickering", "depth fighting"],
  "draftSymptoms": ["Polygons flicker at certain angles", "Overlapping surfaces alternate visibility"],
  "draftSymbols": ["Primitive", "DepthPlane", "Scene", "PolygonGeometry"],
  "draftCategory": "rendering"
}`;

export interface DrafterResult {
  input: NewCandidateInput;
  llmRaw: string;
}

export class Drafter {
  private readonly llm: LLMBackend;
  private readonly systemPrompt: string;

  constructor(opts: DrafterOptions) {
    this.llm = opts.llm;
    this.systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Draft a ProblemCandidate from a CanonicalProblem + Cluster.
   *
   * @param canonical — the canonical problem (already aggregated from cluster)
   * @param cluster — the cluster with member IDs
   * @param memberSummaries — human-readable summaries for each member (issue title/body excerpt)
   */
  async draft(
    canonical: CanonicalProblem,
    cluster: Cluster,
    memberSummaries: string[],
  ): Promise<DrafterResult> {
    const userPrompt = DRAFTER_USER_TEMPLATE(canonical, cluster, memberSummaries);
    const fullPrompt = `${this.systemPrompt}\n\n${userPrompt}`;

    const raw = await this.llm.complete(fullPrompt, {
      temperature: 0.2,
      maxTokens: 2048,
    });

    const parsed = this.parseDraft(raw);

    return {
      input: parsed,
      llmRaw: raw,
    };
  }

  /**
   * Draft for multiple canonical problems in one batch.
   * Each canonical problem should have its own cluster + member summaries.
   */
  async draftBatch(
    items: Array<{
      canonical: CanonicalProblem;
      cluster: Cluster;
      memberSummaries: string[];
    }>,
  ): Promise<DrafterResult[]> {
    const results: DrafterResult[] = [];
    for (const item of items) {
      try {
        results.push(await this.draft(item.canonical, item.cluster, item.memberSummaries));
      } catch (err) {
        // Failed draft — store raw error as llmRaw, empty input, failedDraft flag
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          input: {
            canonicalId: item.canonical.id,
            clusterId: item.cluster.id,
            draftAlias: [],
            draftSymptoms: [],
            draftSymbols: [],
            failedDraft: true,
            llmRaw: `ERROR: ${errMsg}`,
          },
          llmRaw: `ERROR: ${errMsg}`,
        });
      }
    }
    return results;
  }

  private parseDraft(raw: string): NewCandidateInput {
    // Try to extract JSON from a ```json ... ``` fence anywhere in the output,
    // tolerating prose before and after the fence.
    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    const jsonStr = (fenceMatch ? fenceMatch[1] : raw).trim();

    let obj: {
      draftAlias?: string[];
      draftSymptoms?: string[];
      draftSymbols?: string[];
      draftCategory?: string;
    };

    try {
      obj = JSON.parse(jsonStr);
    } catch {
      // Fallback: treat entire raw text as a single alias + symptoms
      obj = {
        draftAlias: ["unknown_pattern"],
        draftSymptoms: [jsonStr.slice(0, 500)],
        draftSymbols: [],
        draftCategory: "debug",
      };
    }

    return {
      canonicalId: "", // filled by caller
      clusterId: "", // filled by caller
      draftAlias: Array.isArray(obj.draftAlias) ? obj.draftAlias : [],
      draftSymptoms: Array.isArray(obj.draftSymptoms) ? obj.draftSymptoms : [],
      draftSymbols: Array.isArray(obj.draftSymbols) ? obj.draftSymbols : [],
      draftCategory:
        obj.draftCategory && typeof obj.draftCategory === "string"
          ? obj.draftCategory
          : null,
    };
  }
}
