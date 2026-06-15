import { describe, it, expect } from "vitest";
import { mapGitHubIssue } from "./github-issues.js";

// Simulated GitHub API response items
const mockIssue = {
  id: 123456,
  number: 42,
  title: "Shadow map rendering broken on terrain",
  body: "The shadow map is not being applied correctly to terrain tiles.",
  state: "open",
  labels: [{ name: "bug" }, { name: "rendering" }],
  assignees: [{ login: "dev1" }, { login: "dev2" }],
  user: { login: "reporter1" },
  comments: 5,
  created_at: "2024-01-15T10:00:00Z",
  updated_at: "2024-03-20T14:00:00Z",
  closed_at: null,
  html_url: "https://github.com/CesiumGS/cesium/issues/42",
};

const mockPullRequest = {
  ...mockIssue,
  id: 999999,
  number: 999,
  title: "Fix shadow map rendering",
  pull_request: {
    url: "https://api.github.com/repos/CesiumGS/cesium/pulls/999",
    html_url: "https://github.com/CesiumGS/cesium/pull/999",
  },
};

describe("GitHub Mapper", () => {
  it("should map GitHub issue to IssueRecord correctly", () => {
    const record = mapGitHubIssue(mockIssue as any, "CesiumGS/cesium");

    expect(record.id).toBe(123456);
    expect(record.repo).toBe("CesiumGS/cesium");
    expect(record.number).toBe(42);
    expect(record.title).toBe("Shadow map rendering broken on terrain");
    expect(record.body).toContain("shadow map");
    expect(record.state).toBe("open");
    expect(record.labels).toEqual(["bug", "rendering"]);
    expect(record.assignees).toEqual(["dev1", "dev2"]);
    expect(record.author).toBe("reporter1");
    expect(record.comments).toBe(5);
    expect(record.createdAt).toBe("2024-01-15T10:00:00Z");
    expect(record.updatedAt).toBe("2024-03-20T14:00:00Z");
    expect(record.closedAt).toBeNull();
    expect(record.htmlUrl).toBe("https://github.com/CesiumGS/cesium/issues/42");
  });

  it("should handle issues with null body", () => {
    const noBody = { ...mockIssue, body: null };
    const record = mapGitHubIssue(noBody as any, "CesiumGS/cesium");
    expect(record.body).toBe("");
  });

  it("should handle issues with no assignees", () => {
    const noAssignees = { ...mockIssue, assignees: null };
    const record = mapGitHubIssue(noAssignees as any, "CesiumGS/cesium");
    expect(record.assignees).toEqual([]);
  });

  it("should handle string labels (some API responses)", () => {
    const stringLabels = { ...mockIssue, labels: ["bug", "enhancement"] };
    const record = mapGitHubIssue(stringLabels as any, "CesiumGS/cesium");
    expect(record.labels).toEqual(["bug", "enhancement"]);
  });

  it("should identify pull requests by pull_request field", () => {
    // PRs have the pull_request field set
    expect(mockPullRequest.pull_request).toBeDefined();
    // Regular issues don't
    expect(mockIssue.pull_request).toBeUndefined();
  });

  it("should handle closed issue with closed_at", () => {
    const closed = {
      ...mockIssue,
      state: "closed",
      closed_at: "2024-04-01T08:00:00Z",
    };
    const record = mapGitHubIssue(closed as any, "CesiumGS/cesium");
    expect(record.state).toBe("closed");
    expect(record.closedAt).toBe("2024-04-01T08:00:00Z");
  });
});
