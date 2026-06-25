/**
 * LLM-based Issue Intent Classifier — fallback for issues that
 * rule-based classifier cannot confidently classify (confidence < 0.6).
 *
 * Uses the same LLMBackend abstraction as Drafter.
 */

import type {
  IssueInput,
  IssueIntentClassifier,
  IntentClassification,
  IntentType,
} from "./intent-classifier.js";
import type { LLMBackend } from "../drafting/llm-backend.js";

const CLASSIFICATION_PROMPT = `You are a GitHub issue classifier for the CesiumJS 3D mapping library.

Classify the following issue into exactly one category:
- bug: A defect, error, crash, or unexpected behavior
- feature_request: A request for new functionality or capability
- enhancement: Improvement to existing functionality (performance, UX, etc.)
- refactor: Code restructuring without behavior change

Respond with ONLY a JSON object:
{
  "intent": "<bug|feature_request|enhancement|refactor>",
  "confidence": <0.0-1.0>,
  "reason": "<one sentence explanation>"
}`;

export interface LLMClassifierOptions {
  llm: LLMBackend;
  /** Confidence threshold below which LLM is consulted (default 0.6) */
  fallbackThreshold?: number;
}

export class LLMClassifier implements IssueIntentClassifier {
  private readonly llm: LLMBackend;
  private readonly fallbackThreshold: number;

  constructor(opts: LLMClassifierOptions) {
    this.llm = opts.llm;
    this.fallbackThreshold = opts.fallbackThreshold ?? 0.6;
  }

  classify(issue: IssueInput): IntentClassification {
    // This is a synchronous interface but LLM is async.
    // For pipeline use, call classifyAsync instead.
    throw new Error(
      "LLMClassifier.classify() is synchronous but requires async LLM call. " +
        "Use classifyAsync() or classifyBatchAsync() instead.",
    );
  }

  classifyBatch(issues: IssueInput[]): IntentClassification[] {
    throw new Error(
      "LLMClassifier.classifyBatch() is synchronous but requires async LLM call. " +
        "Use classifyBatchAsync() instead.",
    );
  }

  /**
   * Async classification for a single issue.
   */
  async classifyAsync(issue: IssueInput): Promise<IntentClassification> {
    const prompt = this.buildPrompt(issue);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: 0.1,
        maxTokens: 256,
      });

      return this.parseResponse(raw);
    } catch (err) {
      // LLM failure — return unknown with low confidence
      return {
        intent: "unknown",
        confidence: 0.1,
        method: "llm",
        reason: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Async batch classification.
   */
  async classifyBatchAsync(issues: IssueInput[]): Promise<IntentClassification[]> {
    const results: IntentClassification[] = [];

    for (const issue of issues) {
      results.push(await this.classifyAsync(issue));
    }

    return results;
  }

  /**
   * Classify only issues where rule-based confidence is below threshold.
   * Returns the original rule-based classification for high-confidence issues.
   */
  async classifyWithFallback(
    issue: IssueInput,
    ruleBasedResult: IntentClassification,
  ): Promise<IntentClassification> {
    if (ruleBasedResult.confidence >= this.fallbackThreshold) {
      return ruleBasedResult;
    }

    return this.classifyAsync(issue);
  }

  /**
   * Batch classify with fallback — only use LLM for low-confidence issues.
   */
  async classifyBatchWithFallback(
    issues: IssueInput[],
    ruleBasedResults: IntentClassification[],
  ): Promise<IntentClassification[]> {
    const results: IntentClassification[] = [];

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      const ruleResult = ruleBasedResults[i]!;

      if (ruleResult.confidence >= this.fallbackThreshold) {
        results.push(ruleResult);
      } else {
        results.push(await this.classifyAsync(issue));
      }
    }

    return results;
  }

  private buildPrompt(issue: IssueInput): string {
    const labelsStr = issue.labels?.length
      ? `\nLabels: ${issue.labels.join(", ")}`
      : "";

    const bodyPreview = issue.body
      ? `\nBody (first 500 chars): ${issue.body.slice(0, 500)}`
      : "";

    return `${CLASSIFICATION_PROMPT}

Title: ${issue.title}${labelsStr}${bodyPreview}`;
  }

  private parseResponse(raw: string): IntentClassification {
    // Extract JSON from response (handle markdown fences)
    const jsonStr = raw
      .replace(/^```(?:json)?\s*/im, "")
      .replace(/\s*```$/im, "")
      .trim();

    try {
      const obj = JSON.parse(jsonStr);

      const validIntents: IntentType[] = [
        "bug",
        "feature_request",
        "enhancement",
        "refactor",
      ];
      const intent = validIntents.includes(obj.intent)
        ? (obj.intent as IntentType)
        : "unknown";

      const confidence =
        typeof obj.confidence === "number"
          ? Math.min(1, Math.max(0, obj.confidence))
          : 0.5;

      return {
        intent,
        confidence,
        method: "llm",
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
      };
    } catch {
      // Failed to parse — try keyword extraction
      const lower = raw.toLowerCase();
      if (lower.includes("bug")) {
        return { intent: "bug", confidence: 0.6, method: "llm", reason: "LLM mentioned 'bug'" };
      }
      if (lower.includes("feature")) {
        return { intent: "feature_request", confidence: 0.5, method: "llm", reason: "LLM mentioned 'feature'" };
      }

      return {
        intent: "unknown",
        confidence: 0.2,
        method: "llm",
        reason: "Failed to parse LLM response",
      };
    }
  }
}
