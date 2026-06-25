/**
 * Issue Intent Classification — classifies GitHub issues into
 * Bug / Feature Request / Enhancement / Refactor / Unknown.
 *
 * Only Bug issues enter the Diagnosis Mining pipeline.
 * Feature Requests go to Capability KB (future).
 * Enhancement / Refactor are filtered out.
 */

export type IntentType =
  | "bug"
  | "feature_request"
  | "enhancement"
  | "refactor"
  | "unknown";

export interface IntentClassification {
  intent: IntentType;
  confidence: number; // 0..1
  method: "rule" | "llm";
  reason?: string; // human-readable explanation
}

export interface IssueInput {
  title: string;
  body?: string;
  labels?: string[];
}

export interface IssueIntentClassifier {
  /**
   * Classify a single issue.
   */
  classify(issue: IssueInput): IntentClassification;

  /**
   * Classify a batch of issues.
   */
  classifyBatch(issues: IssueInput[]): IntentClassification[];
}

/**
 * Utility: filter classifications to only Bug intents.
 */
export function filterBugIssues<T extends IssueInput>(
  issues: T[],
  classifications: IntentClassification[],
): T[] {
  return issues.filter((_, i) => classifications[i]?.intent === "bug");
}
