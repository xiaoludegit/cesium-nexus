import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGeneratedPattern,
  promoteCandidate,
  loadGeneratedPatterns,
  diffGenerated,
  type GeneratedPattern,
} from "./promoter.js";
import type { ProblemCandidate, CanonicalProblem } from "../types.js";
import type { ProblemPattern } from "@cesium-nexus/shared";

function makeCanonical(overrides: Partial<CanonicalProblem> = {}): CanonicalProblem {
  return {
    id: "canonical/1",
    title: "Z-Fighting",
    aliases: ["z-fighting", "depth fighting"],
    representativeIssueId: 42,
    clusterIds: ["cluster/1"],
    experienceIds: [],
    confidence: 0.85,
    status: "candidate",
    createdAt: Date.now(),
    reviewedAt: null,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ProblemCandidate> = {}): ProblemCandidate {
  return {
    id: "candidate/1",
    canonicalId: "canonical/1",
    clusterId: "cluster/1",
    draftAlias: ["z-fighting", "polygon flicker"],
    draftSymptoms: ["Polygons flicker at certain angles"],
    draftSymbols: ["Primitive", "DepthPlane"],
    draftCategory: "rendering",
    llmRaw: '{"draftAlias":["z-fighting"]}',
    qualityScore: 0.95,
    dupOf: null,
    failedDraft: false,
    status: "approved",
    reviewedAt: Date.now(),
    createdAt: Date.now() - 1000,
    sourceCount: 4,
    issueCount: 3,
    forumCount: 1,
    experienceCount: 0,
    ...overrides,
  };
}

describe("buildGeneratedPattern", () => {
  it("produces a valid GeneratedPattern from default inputs", () => {
    const g = buildGeneratedPattern({
      candidate: makeCandidate(),
      canonical: makeCanonical(),
    });

    expect(g.id).toBe("z_fighting"); // sanitized from first canonical alias
    expect(g.name).toBe("Z-Fighting");
    expect(g.category).toBe("rendering");
    expect(g.severity).toBe("medium"); // default
    expect(g.aliases).toContain("z-fighting");
    expect(g.aliases).toContain("depth fighting");
    expect(g.aliases).toContain("polygon flicker");
    expect(g.triggerKeywords).toContain("z-fighting");
    expect(g.triggerKeywords).toContain("polygon flicker");
    expect(g.symptoms).toEqual(["Polygons flicker at certain angles"]);
    expect(g.relatedSymbols).toEqual(["Primitive", "DepthPlane"]);
    expect(g.candidateId).toBe("candidate/1");
    expect(g.canonicalId).toBe("canonical/1");
    expect(g.sourceCount).toBe(4);
    expect(g.promotedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Fallback fields when reviewer hasn't filled them
    expect(g.possibleCauses[0]).toMatch(/not yet filled/);
    expect(g.fixSuggestions[0]).toMatch(/not yet filled/);
    expect(g.investigationSteps[0]).toMatch(/not yet filled/);
    expect(g.relatedStages).toEqual([]);
  });

  it("honors patternId / patternName / severity overrides", () => {
    const g = buildGeneratedPattern({
      candidate: makeCandidate(),
      canonical: makeCanonical(),
      patternId: "custom_id",
      patternName: "Custom Name",
      severity: "high",
      possibleCauses: ["Real cause"],
      fixSuggestions: ["Real fix"],
    });

    expect(g.id).toBe("custom_id");
    expect(g.name).toBe("Custom Name");
    expect(g.severity).toBe("high");
    expect(g.possibleCauses).toEqual(["Real cause"]);
    expect(g.fixSuggestions).toEqual(["Real fix"]);
  });

  it("falls back to candidate id when no aliases available", () => {
    const g = buildGeneratedPattern({
      candidate: makeCandidate({ draftAlias: [] }),
      canonical: makeCanonical({ aliases: [] }),
    });
    expect(g.id).toBe("candidate_1"); // sanitized "candidate/1"
  });

  it("normalizes unknown draft category to 'debug'", () => {
    const g = buildGeneratedPattern({
      candidate: makeCandidate({ draftCategory: "unknown_cat" }),
      canonical: makeCanonical(),
    });
    expect(g.category).toBe("debug");
  });

  it("uses trigger keywords from both draftAlias and extra triggerKeywords", () => {
    const g = buildGeneratedPattern({
      candidate: makeCandidate({ draftAlias: ["a", "b"] }),
      canonical: makeCanonical(),
      triggerKeywords: ["c", "b"], // "b" deduped
    });
    expect(g.triggerKeywords.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("promoteCandidate (I/O)", () => {
  let tempDir: string;
  let genPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mining-promote-"));
    genPath = join(tempDir, "generated-patterns.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates the file when it does not exist", async () => {
    const entry = await promoteCandidate(
      { candidate: makeCandidate(), canonical: makeCanonical() },
      genPath,
    );
    expect(entry.id).toBe("z_fighting");

    const onDisk = JSON.parse(await readFile(genPath, "utf-8"));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].id).toBe("z_fighting");
    expect(onDisk[0].candidateId).toBe("candidate/1");
  });

  it("is idempotent on candidateId (re-promote replaces the same entry)", async () => {
    await promoteCandidate(
      { candidate: makeCandidate(), canonical: makeCanonical() },
      genPath,
    );
    const v2 = await promoteCandidate(
      {
        candidate: makeCandidate(),
        canonical: makeCanonical(),
        severity: "high",
      },
      genPath,
    );

    const onDisk = await loadGeneratedPatterns(genPath);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]!.severity).toBe("high");
    expect(v2.severity).toBe("high");
  });

  it("appends new entries when candidateId differs", async () => {
    await promoteCandidate(
      { candidate: makeCandidate(), canonical: makeCanonical() },
      genPath,
    );
    await promoteCandidate(
      {
        candidate: makeCandidate({ id: "candidate/2", draftAlias: ["shader-error"] }),
        canonical: makeCanonical({ id: "canonical/2", aliases: ["shader-error"] }),
      },
      genPath,
    );

    const onDisk = await loadGeneratedPatterns(genPath);
    expect(onDisk).toHaveLength(2);
    expect(onDisk.map((p) => p.id).sort()).toEqual(["shader_error", "z_fighting"]);
  });

  it("throws when id collides with a different candidateId", async () => {
    await promoteCandidate(
      { candidate: makeCandidate(), canonical: makeCanonical() },
      genPath,
    );

    await expect(
      promoteCandidate(
        {
          candidate: makeCandidate({ id: "candidate/999" }), // different candidate
          canonical: makeCanonical(), // same aliases → same id "z_fighting"
        },
        genPath,
      ),
    ).rejects.toThrow(/Promotion conflict/);
  });

  it("pretty-prints JSON (2-space indent) for easy manual review", async () => {
    await promoteCandidate(
      { candidate: makeCandidate(), canonical: makeCanonical() },
      genPath,
    );
    const raw = await readFile(genPath, "utf-8");
    expect(raw).toContain("\n  "); // indented
    expect(raw).toMatch(/\n$/); // trailing newline
  });
});

describe("diffGenerated", () => {
  let tempDir: string;
  let genPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mining-diff-"));
    genPath = join(tempDir, "generated-patterns.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sampleGenerated: GeneratedPattern = {
    id: "z_fighting",
    name: "Z-Fighting / Polygon Flickering",
    category: "rendering",
    severity: "high",
    aliases: ["z-fighting", "polygon flickering"],
    triggerKeywords: ["flickering"],
    symptoms: ["Polygons flicker"],
    possibleCauses: ["Coplanar primitives"],
    relatedSymbols: ["Primitive"],
    relatedStages: ["depth_pass"],
    issueQueries: ["z-fighting"],
    investigationSteps: ["Check logarithmicDepthBuffer"],
    fixSuggestions: ["Enable logarithmicDepthBuffer"],
    candidateId: "candidate/1",
    canonicalId: "canonical/1",
    clusterId: "cluster/1",
    promotedAt: "2026-06-23T00:00:00.000Z",
    sourceCount: 3,
  };

  const sampleCurrent: ProblemPattern = {
    id: "z_fighting",
    name: "Z-Fighting / Polygon Flickering",
    category: "rendering",
    severity: "high",
    aliases: ["z-fighting", "polygon flickering"],
    triggerKeywords: ["flickering"],
    symptoms: ["Polygons flicker"],
    possibleCauses: ["Coplanar primitives"],
    relatedSymbols: ["Primitive"],
    relatedStages: ["depth_pass"],
    issueQueries: ["z-fighting"],
    investigationSteps: ["Check logarithmicDepthBuffer"],
    fixSuggestions: ["Enable logarithmicDepthBuffer"],
  };

  it("returns empty added/updated when no file exists", async () => {
    const diff = await diffGenerated(genPath, [sampleCurrent]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("classifies matching entries as unchanged", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    await writeFile(genPath, JSON.stringify([sampleGenerated]), "utf-8");

    const diff = await diffGenerated(genPath, [sampleCurrent]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.updated).toHaveLength(0);
  });

  it("classifies new id as added", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    const newEntry: GeneratedPattern = {
      ...sampleGenerated,
      id: "new_pattern",
    };
    await writeFile(genPath, JSON.stringify([newEntry]), "utf-8");

    const diff = await diffGenerated(genPath, [sampleCurrent]);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.id).toBe("new_pattern");
  });

  it("classifies content drift on same id as updated", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    const drifted: GeneratedPattern = {
      ...sampleGenerated,
      severity: "low", // changed
    };
    await writeFile(genPath, JSON.stringify([drifted]), "utf-8");

    const diff = await diffGenerated(genPath, [sampleCurrent]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]!.generated.severity).toBe("low");
    expect(diff.updated[0]!.current.severity).toBe("high");
  });
});
