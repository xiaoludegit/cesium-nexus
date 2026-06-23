import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCanonicalProblems,
  resetCanonicalSeq,
} from "./canonical-problem.js";
import type { Cluster } from "../types.js";

describe("buildCanonicalProblems", () => {
  beforeEach(() => resetCanonicalSeq(0));

  it("produces one canonical per cluster with stable ids", () => {
    const clusters: Cluster[] = [
      { id: "cluster/1", memberIds: ["m1", "m2"] },
      { id: "cluster/2", memberIds: ["m3", "m4", "m5"] },
    ];

    const result = buildCanonicalProblems({ clusters });

    expect(result.length).toBe(2);
    expect(result[0]!.id).toBe("canonical/1");
    expect(result[1]!.id).toBe("canonical/2");
    expect(result[0]!.clusterIds).toEqual(["cluster/1"]);
    expect(result[1]!.clusterIds).toEqual(["cluster/2"]);
    expect(result[0]!.status).toBe("candidate");
  });

  it("resolves representativeIssueId via issueIdByMemberId", () => {
    const clusters: Cluster[] = [
      { id: "cluster/1", memberIds: ["m1", "m2"] },
    ];

    const result = buildCanonicalProblems({
      clusters,
      issueIdByMemberId: (m) => (m === "m2" ? 4242 : null),
    });

    expect(result[0]!.representativeIssueId).toBe(4242);
  });

  it("collects experienceIds across members", () => {
    const clusters: Cluster[] = [
      { id: "cluster/1", memberIds: ["m1", "m2", "m3"] },
    ];

    const result = buildCanonicalProblems({
      clusters,
      experienceIdByMemberId: (m) => {
        if (m === "m1") return 100;
        if (m === "m3") return 300;
        return null;
      },
    });

    expect(result[0]!.experienceIds.sort()).toEqual(["100", "300"]);
  });

  it("confidence scales with cluster size and score", () => {
    const small: Cluster[] = [
      { id: "c1", memberIds: ["a", "b"], score: 0.6 },
    ];
    const large: Cluster[] = [
      { id: "c2", memberIds: ["a", "b", "c", "d", "e", "f"], score: 0.9 },
    ];

    resetCanonicalSeq(0);
    const r1 = buildCanonicalProblems({ clusters: small })[0]!.confidence;
    resetCanonicalSeq(0);
    const r2 = buildCanonicalProblems({ clusters: large })[0]!.confidence;

    expect(r2).toBeGreaterThan(r1);
    expect(r1).toBeLessThanOrEqual(1);
    expect(r2).toBeLessThanOrEqual(1);
  });

  it("returns empty for empty clusters", () => {
    expect(buildCanonicalProblems({ clusters: [] })).toEqual([]);
  });
});
