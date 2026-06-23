import type { CanonicalProblem, CanonicalProblemStatus, Cluster } from "../types.js";

let _seq = 0;

export interface CanonicalProblemFactoryOptions {
  clusters: Cluster[];
  experienceIdByMemberId?: (memberId: string) => number | null;
  issueIdByMemberId?: (memberId: string) => number | null;
}

export function buildCanonicalProblems(
  opts: CanonicalProblemFactoryOptions,
): CanonicalProblem[] {
  const now = Date.now();
  return opts.clusters.map((c) => {
    _seq++;
    const expIds: string[] = [];
    let repIssue: number | null = null;

    for (const m of c.memberIds) {
      if (opts.experienceIdByMemberId) {
        const e = opts.experienceIdByMemberId(m);
        if (e != null) expIds.push(String(e));
      }
      if (repIssue == null && opts.issueIdByMemberId) {
        const i = opts.issueIdByMemberId(m);
        if (i != null) repIssue = i;
      }
    }

    return {
      id: `canonical/${_seq}`,
      title: "",
      aliases: [],
      representativeIssueId: repIssue,
      clusterIds: [c.id],
      experienceIds: expIds,
      confidence: Math.min(1, (c.score ?? 0) * 0.5 + c.memberIds.length * 0.05),
      status: "candidate" satisfies CanonicalProblemStatus,
      createdAt: now,
      reviewedAt: null,
    };
  });
}

export function resetCanonicalSeq(n = 0): void {
  _seq = n;
}
