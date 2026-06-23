import { describe, it, expect, beforeEach } from "vitest";
import { buildCandidate, resetCandidateSeq } from "./candidate-factory.js";

describe("buildCandidate", () => {
  beforeEach(() => resetCandidateSeq(0));

  it("produces sequential ids with pending status", () => {
    const c = buildCandidate({
      canonicalId: "canonical/1",
      clusterId: "cluster/1",
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Polygons flicker"],
      draftSymbols: ["DepthPlane"],
    });

    expect(c.id).toBe("candidate/1");
    expect(c.status).toBe("pending");
    expect(c.canonicalId).toBe("canonical/1");
    expect(c.draftAlias).toEqual(["z-fighting"]);
    expect(c.dupOf).toBeNull();
    expect(c.qualityScore).toBeNull();
    expect(c.reviewedAt).toBeNull();
  });

  it("aggregates source_count from issue/forum/experience counts", () => {
    const c = buildCandidate({
      canonicalId: "canonical/1",
      clusterId: "cluster/1",
      draftAlias: [],
      draftSymptoms: [],
      draftSymbols: [],
      issueCount: 5,
      forumCount: 3,
      experienceCount: 2,
    });

    expect(c.sourceCount).toBe(10);
    expect(c.issueCount).toBe(5);
    expect(c.forumCount).toBe(3);
    expect(c.experienceCount).toBe(2);
  });

  it("preserves llmRaw + dupOf when provided", () => {
    const c = buildCandidate({
      canonicalId: "canonical/1",
      clusterId: "cluster/1",
      draftAlias: ["x"],
      draftSymptoms: ["y"],
      draftSymbols: ["z"],
      llmRaw: "raw-json-foo",
      dupOf: "z_fighting",
      qualityScore: 0.82,
    });

    expect(c.llmRaw).toBe("raw-json-foo");
    expect(c.dupOf).toBe("z_fighting");
    expect(c.qualityScore).toBeCloseTo(0.82);
  });

  it("defaults missing counts to zero", () => {
    const c = buildCandidate({
      canonicalId: "canonical/1",
      clusterId: "cluster/1",
      draftAlias: [],
      draftSymptoms: [],
      draftSymbols: [],
    });

    expect(c.sourceCount).toBe(0);
    expect(c.issueCount).toBe(0);
    expect(c.forumCount).toBe(0);
    expect(c.experienceCount).toBe(0);
  });
});
