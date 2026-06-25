/**
 * Rule-based Issue Intent Classifier — fast, deterministic classification
 * based on title keywords and labels.
 *
 * Priority: labels > title keywords > default (unknown)
 */

import type {
  IssueInput,
  IssueIntentClassifier,
  IntentClassification,
  IntentType,
} from "./intent-classifier.js";

// ─── Keyword rules (ordered by priority) ──────────────────────────

interface KeywordRule {
  intent: IntentType;
  keywords: string[];
  weight: number; // confidence bonus
}

const LABEL_RULES: Array<{ label: string; intent: IntentType; confidence: number }> = [
  { label: "bug", intent: "bug", confidence: 0.95 },
  { label: "type: bug", intent: "bug", confidence: 0.95 },
  { label: "type:bug", intent: "bug", confidence: 0.95 },
  { label: "defect", intent: "bug", confidence: 0.9 },
  { label: "feature", intent: "feature_request", confidence: 0.9 },
  { label: "type: feature", intent: "feature_request", confidence: 0.9 },
  { label: "type:feature", intent: "feature_request", confidence: 0.9 },
  { label: "enhancement", intent: "enhancement", confidence: 0.85 },
  { label: "type: enhancement", intent: "enhancement", confidence: 0.85 },
  { label: "refactor", intent: "refactor", confidence: 0.85 },
  { label: "type: refactor", intent: "refactor", confidence: 0.85 },
];

const BUG_KEYWORDS: KeywordRule = {
  intent: "bug",
  keywords: [
    "bug", "fix", "error", "crash", "broken", "fails", "failure",
    "not working", "doesn't work", "does not work", "issue",
    "regression", "incorrect", "wrong", "unexpected", "anomaly",
    "glitch", "defect", "fault", "malfunction", "corrupt",
    "flicker", "flickering", "z-fighting", "z-fighting",
    "clipping", "disappear", "missing", "leak",
  ],
  weight: 0.3,
};

const FEATURE_KEYWORDS: KeywordRule = {
  intent: "feature_request",
  keywords: [
    "feature", "request", "add support", "implement", "support for",
    "would be nice", "suggestion", "wish", "proposal",
    "new feature", "feature request", "add ability",
    "create reference", "reference implementation",
  ],
  weight: 0.3,
};

const ENHANCEMENT_KEYWORDS: KeywordRule = {
  intent: "enhancement",
  keywords: [
    "enhancement", "improve", "optimization", "optimize",
    "performance", "faster", "speed up", "better",
    "refine", "polish", "tweak",
  ],
  weight: 0.2,
};

const REFACTOR_KEYWORDS: KeywordRule = {
  intent: "refactor",
  keywords: [
    "refactor", "cleanup", "clean up", "restructure",
    "reorganize", "simplify", "decouple", "extract",
  ],
  weight: 0.2,
};

const KEYWORD_RULES: KeywordRule[] = [
  BUG_KEYWORDS,
  FEATURE_KEYWORDS,
  ENHANCEMENT_KEYWORDS,
  REFACTOR_KEYWORDS,
];

// ─── Classifier ───────────────────────────────────────────────────

export class RuleBasedClassifier implements IssueIntentClassifier {
  private readonly labelRules: typeof LABEL_RULES;
  private readonly keywordRules: KeywordRule[];

  constructor(
    labelRules?: typeof LABEL_RULES,
    keywordRules?: KeywordRule[],
  ) {
    this.labelRules = labelRules ?? LABEL_RULES;
    this.keywordRules = keywordRules ?? KEYWORD_RULES;
  }

  classify(issue: IssueInput): IntentClassification {
    // Step 1: Try label-based classification (highest confidence)
    const labelResult = this.classifyByLabels(issue);
    if (labelResult) return labelResult;

    // Step 2: Try keyword-based classification
    const keywordResult = this.classifyByKeywords(issue);
    if (keywordResult) return keywordResult;

    // Step 3: Default — unknown
    return {
      intent: "unknown",
      confidence: 0.1,
      method: "rule",
      reason: "No matching labels or keywords",
    };
  }

  classifyBatch(issues: IssueInput[]): IntentClassification[] {
    return issues.map((issue) => this.classify(issue));
  }

  private classifyByLabels(issue: IssueInput): IntentClassification | null {
    if (!issue.labels || issue.labels.length === 0) return null;

    const lowerLabels = issue.labels.map((l) => l.toLowerCase().trim());

    for (const rule of this.labelRules) {
      if (lowerLabels.includes(rule.label.toLowerCase())) {
        return {
          intent: rule.intent,
          confidence: rule.confidence,
          method: "rule",
          reason: `Label "${rule.label}" matches`,
        };
      }
    }

    return null;
  }

  private classifyByKeywords(issue: IssueInput): IntentClassification | null {
    const text = `${issue.title} ${issue.body ?? ""}`.toLowerCase();

    // Count matches per intent type
    const scores: Record<string, { count: number; keywords: string[] }> = {};

    for (const rule of this.keywordRules) {
      let count = 0;
      const matched: string[] = [];

      for (const kw of rule.keywords) {
        if (text.includes(kw.toLowerCase())) {
          count++;
          matched.push(kw);
        }
      }

      if (count > 0) {
        scores[rule.intent] = { count, keywords: matched };
      }
    }

    // Find the intent with the most keyword matches
    let bestIntent: IntentType | null = null;
    let bestCount = 0;
    let bestKeywords: string[] = [];

    for (const [intent, data] of Object.entries(scores)) {
      if (data.count > bestCount) {
        bestCount = data.count;
        bestIntent = intent as IntentType;
        bestKeywords = data.keywords;
      }
    }

    if (bestIntent && bestCount > 0) {
      // Confidence = base (0.5) + weight * min(count, 5) / 5
      const rule = this.keywordRules.find((r) => r.intent === bestIntent);
      const weight = rule?.weight ?? 0.2;
      const confidence = Math.min(0.95, 0.5 + weight * Math.min(bestCount, 5) / 5);

      return {
        intent: bestIntent,
        confidence,
        method: "rule",
        reason: `Keywords matched: ${bestKeywords.slice(0, 3).join(", ")}`,
      };
    }

    return null;
  }
}
