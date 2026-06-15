import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { initSchema, IssueRepo } from "./index.js";
import type { Database } from "./schema.js";
import type { IssueRecord } from "@cesium-nexus/shared";

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 1001,
    repo: "CesiumGS/cesium",
    number: 101,
    title: "DrawCommand rendering issue",
    body: "The DrawCommand is not rendering correctly on terrain tiles.",
    state: "open",
    labels: ["bug", "rendering"],
    assignees: ["dev1"],
    author: "user1",
    comments: 3,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-03-20T14:00:00Z",
    closedAt: null,
    htmlUrl: "https://github.com/CesiumGS/cesium/issues/101",
    ...overrides,
  };
}

describe("IssueRepo", () => {
  let db: Database;
  let repo: IssueRepo;

  beforeEach(() => {
    db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    initSchema(db);
    repo = new IssueRepo(db);
  });

  // ---- Unit Tests ----

  it("should upsertMany issues in a batch", () => {
    const issues = [
      makeIssue({ id: 1, number: 1, title: "Issue A" }),
      makeIssue({ id: 2, number: 2, title: "Issue B" }),
      makeIssue({ id: 3, number: 3, title: "Issue C" }),
    ];
    const count = repo.upsertMany(issues);
    expect(count).toBe(3);
    expect(repo.totalCount()).toBe(3);
  });

  it("should upsert (update) existing issues by id", () => {
    repo.upsertMany([makeIssue({ id: 1, number: 1, title: "Original" })]);
    expect(repo.totalCount()).toBe(1);

    repo.upsertMany([makeIssue({ id: 1, number: 1, title: "Updated" })]);
    expect(repo.totalCount()).toBe(1);

    const results = repo.searchFts("Updated");
    expect(results.length).toBe(1);
    expect(results[0].issue.title).toBe("Updated");
  });

  // ---- FTS Tests ----

  it("should search FTS by title match", () => {
    repo.upsertMany([
      makeIssue({ id: 1, number: 1, title: "Shadow map artifacts on terrain" }),
      makeIssue({ id: 2, number: 2, title: "Camera flyTo animation broken" }),
    ]);

    const results = repo.searchFts("shadow");
    expect(results.length).toBe(1);
    expect(results[0].issue.number).toBe(1);
  });

  it("should search FTS by body match", () => {
    repo.upsertMany([
      makeIssue({
        id: 1,
        number: 1,
        title: "Rendering issue",
        body: "The atmosphere shader is causing GPU errors on some devices.",
      }),
    ]);

    const results = repo.searchFts("atmosphere");
    expect(results.length).toBe(1);
    expect(results[0].issue.body).toContain("atmosphere");
  });

  it("should rank results by BM25", () => {
    repo.upsertMany([
      makeIssue({
        id: 1,
        number: 1,
        title: "Terrain issue",
        body: "The terrain is broken.",
      }),
      makeIssue({
        id: 2,
        number: 2,
        title: "Terrain rendering performance",
        body: "Terrain tile loading is slow. Terrain LOD needs optimization. Terrain cache size should be increased for better terrain streaming.",
      }),
    ]);

    const results = repo.searchFts("terrain");
    expect(results.length).toBe(2);
    // BM25 scores are negative numbers — lower is better (higher relevance)
    expect(typeof results[0].score).toBe("number");
    expect(typeof results[1].score).toBe("number");
    // Results should be ordered by ascending score (best first)
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
  });

  it("should filter by state (open)", () => {
    repo.upsertMany([
      makeIssue({ id: 1, number: 1, title: "Open terrain bug", state: "open" }),
      makeIssue({ id: 2, number: 2, title: "Closed terrain bug", state: "closed" }),
    ]);

    const results = repo.searchFts("terrain", { state: "open" });
    expect(results.length).toBe(1);
    expect(results[0].issue.state).toBe("open");
    expect(results[0].issue.number).toBe(1);
  });

  it("should filter by state (closed)", () => {
    repo.upsertMany([
      makeIssue({ id: 1, number: 1, title: "Open camera bug", state: "open" }),
      makeIssue({ id: 2, number: 2, title: "Closed camera bug", state: "closed" }),
    ]);

    const results = repo.searchFts("camera", { state: "closed" });
    expect(results.length).toBe(1);
    expect(results[0].issue.state).toBe("closed");
  });

  it("should return score in searchFts results", () => {
    repo.upsertMany([makeIssue({ id: 1, number: 1, title: "Primitive rendering" })]);
    const results = repo.searchFts("Primitive");
    expect(results.length).toBe(1);
    expect(typeof results[0].score).toBe("number");
  });

  it("should handle empty FTS query gracefully", () => {
    repo.upsertMany([makeIssue()]);
    expect(repo.searchFts("")).toEqual([]);
    expect(repo.searchFts("!!!")).toEqual([]);
  });

  // ---- Sync Cursor ----

  it("should get/set sync cursor from meta table", () => {
    expect(repo.getSyncCursor()).toBeNull();

    repo.setSyncCursor("2024-06-01T12:00:00Z");
    expect(repo.getSyncCursor()).toBe("2024-06-01T12:00:00Z");

    repo.setSyncCursor("2024-06-02T08:00:00Z");
    expect(repo.getSyncCursor()).toBe("2024-06-02T08:00:00Z");
  });

  // ---- Clear ----

  it("should clear all issues", () => {
    repo.upsertMany([
      makeIssue({ id: 1, number: 1 }),
      makeIssue({ id: 2, number: 2 }),
    ]);
    expect(repo.totalCount()).toBe(2);

    repo.clear();
    expect(repo.totalCount()).toBe(0);
    expect(repo.searchFts("DrawCommand")).toEqual([]);
  });
});
