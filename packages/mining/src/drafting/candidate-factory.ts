import type { ProblemCandidate, CandidateStatus } from "../types.js";

export interface NewCandidateInput {
  canonicalId: string;
  clusterId: string;

  draftAlias: string[];
  draftSymptoms: string[];
  draftSymbols: string[];
  draftCategory?: string | null;

  llmRaw?: string | null;
  qualityScore?: number | null;
  dupOf?: string | null;

  issueCount?: number;
  forumCount?: number;
  experienceCount?: number;
}

let _seq = 0;

export function buildCandidate(input: NewCandidateInput): ProblemCandidate {
  _seq++;
  const issueCount = input.issueCount ?? 0;
  const forumCount = input.forumCount ?? 0;
  const experienceCount = input.experienceCount ?? 0;
  return {
    id: `candidate/${_seq}`,
    canonicalId: input.canonicalId,
    clusterId: input.clusterId,

    draftAlias: input.draftAlias,
    draftSymptoms: input.draftSymptoms,
    draftSymbols: input.draftSymbols,
    draftCategory: input.draftCategory ?? null,

    llmRaw: input.llmRaw ?? null,
    qualityScore: input.qualityScore ?? null,
    dupOf: input.dupOf ?? null,

    status: "pending" satisfies CandidateStatus,
    reviewedAt: null,
    createdAt: Date.now(),

    sourceCount: issueCount + forumCount + experienceCount,
    issueCount,
    forumCount,
    experienceCount,
  };
}

export function resetCandidateSeq(n = 0): void {
  _seq = n;
}
