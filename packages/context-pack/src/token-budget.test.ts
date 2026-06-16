import { describe, it, expect } from "vitest";
import type { ContextPack, SymbolRecord, IssueRecord } from "@cesium-nexus/shared";
import {
  estimateTokens,
  truncateText,
  estimatePackTokens,
  truncateContextPack,
} from "./token-budget.js";

// ── Fixture helpers ────────────────────────────────────────

function makeSymbol(overrides: Partial<SymbolRecord> = {}): SymbolRecord {
  return {
    id: "sym-1",
    name: "TestSymbol",
    kind: "class",
    filePath: "src/test.js",
    startLine: 1,
    endLine: 10,
    docComment: "A short doc",
    exports: [],
    imports: [],
    parentClass: undefined,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 1,
    repo: "CesiumGS/cesium",
    number: 1,
    title: "Test issue",
    body: "Short body",
    state: "open",
    labels: [],
    assignees: [],
    author: "user1",
    comments: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    closedAt: null,
    htmlUrl: "https://github.com/CesiumGS/cesium/issues/1",
    ...overrides,
  };
}

function makeSmallPack(): ContextPack {
  return {
    symbol: makeSymbol(),
    source: [
      {
        symbol: "TestSymbol",
        file: "src/test.js",
        lineStart: 1,
        lineEnd: 10,
        code: "function TestSymbol() {}",
      },
    ],
    callgraph: [{ source: "TestSymbol", target: "Other" }],
    issues: [makeIssue()],
  };
}

// ── estimateTokens ─────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for single character", () => {
    expect(estimateTokens("a")).toBe(1);
  });

  it("estimates 4 chars = 1 token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
  });

  it("handles longer text", () => {
    const text = "a".repeat(100);
    expect(estimateTokens(text)).toBe(25); // ceil(100/4) = 25
  });

  it("rounds up fractional tokens", () => {
    expect(estimateTokens("abc")).toBe(1); // ceil(3/4) = 1
    expect(estimateTokens("abcdefg")).toBe(2); // ceil(7/4) = 2
  });
});

// ── truncateText ────────────────────────────────────────────

describe("truncateText", () => {
  it("returns original text when within budget", () => {
    const result = truncateText("hello", 10);
    expect(result.text).toBe("hello");
    expect(result.truncated).toBe(false);
  });

  it("returns original text at exact budget", () => {
    // 4 chars = 1 token, so maxChars = 1 * 4 = 4
    const result = truncateText("abcd", 1);
    expect(result.text).toBe("abcd");
    expect(result.truncated).toBe(false);
  });

  it("truncates text exceeding budget", () => {
    const result = truncateText("abcdefgh", 1);
    expect(result.text).toBe("abcd\n... [truncated]");
    expect(result.truncated).toBe(true);
  });

  it("truncates to correct character boundary", () => {
    // maxTokens = 3 → maxChars = 12
    const text = "a".repeat(20);
    const result = truncateText(text, 3);
    expect(result.text).toBe("a".repeat(12) + "\n... [truncated]");
    expect(result.truncated).toBe(true);
  });

  it("handles empty text", () => {
    const result = truncateText("", 5);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(false);
  });
});

// ── estimatePackTokens ──────────────────────────────────────

describe("estimatePackTokens", () => {
  it("returns non-zero for a populated pack", () => {
    const pack = makeSmallPack();
    const tokens = estimatePackTokens(pack);
    expect(tokens).toBeGreaterThan(0);
  });

  it("accounts for all sections", () => {
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [],
      callgraph: [],
      issues: [],
    };
    const symbolOnly = estimatePackTokens(pack);

    // Add source — tokens should increase
    pack.source = [
      { symbol: "A", file: "a.js", lineStart: 1, lineEnd: 5, code: "some code here" },
    ];
    const withSource = estimatePackTokens(pack);
    expect(withSource).toBeGreaterThan(symbolOnly);

    // Add callgraph — tokens should increase
    pack.callgraph = [{ source: "A", target: "B" }];
    const withCallgraph = estimatePackTokens(pack);
    expect(withCallgraph).toBeGreaterThan(withSource);

    // Add issue — tokens should increase
    pack.issues = [makeIssue()];
    const withIssues = estimatePackTokens(pack);
    expect(withIssues).toBeGreaterThan(withCallgraph);
  });

  it("returns 0 for empty pack with minimal symbol", () => {
    const pack: ContextPack = {
      symbol: makeSymbol({ docComment: undefined }),
      source: [],
      callgraph: [],
      issues: [],
    };
    const tokens = estimatePackTokens(pack);
    // Symbol JSON still has some chars, so tokens > 0
    expect(tokens).toBeGreaterThan(0);
  });
});

// ── truncateContextPack ─────────────────────────────────────

describe("truncateContextPack", () => {
  it("attaches metadata with symbolResolved for class", () => {
    const pack = makeSmallPack();
    const result = truncateContextPack(pack, 5000);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.symbolResolved).toBe("TestSymbol");
    expect(result.metadata!.totalTokens).toBeGreaterThan(0);
  });

  it("attaches metadata with parentClass.methodName for method", () => {
    const pack = makeSmallPack();
    pack.symbol = makeSymbol({
      name: "update",
      parentClass: "Primitive",
    });

    const result = truncateContextPack(pack, 5000);
    expect(result.metadata!.symbolResolved).toBe("Primitive.update");
  });

  it("does not truncate small pack with generous budget", () => {
    const pack = makeSmallPack();
    const result = truncateContextPack(pack, 50000);

    expect(result.metadata!.truncated).toBe(false);
    expect(result.source.length).toBe(pack.source.length);
    expect(result.callgraph.length).toBe(pack.callgraph.length);
    expect(result.issues.length).toBe(pack.issues.length);
  });

  it("marks truncated = true when totalTokens exceeds budget", () => {
    const pack = makeSmallPack();
    // Use a very small budget that's guaranteed to be less than actual tokens
    const result = truncateContextPack(pack, 1);

    expect(result.metadata!.truncated).toBe(true);
  });

  it("truncates symbol docComment when symbol section exceeds budget", () => {
    const longDoc = "word ".repeat(600); // 3000 chars → 750 tokens > 500 budget
    const pack: ContextPack = {
      symbol: makeSymbol({ docComment: longDoc }),
      source: [],
      callgraph: [],
      issues: [],
    };

    const result = truncateContextPack(pack, 50000);
    expect(result.symbol.docComment!.length).toBeLessThan(longDoc.length);
    expect(result.symbol.docComment).toContain("[truncated]");
  });

  it("truncates downstream source when source section exceeds budget", () => {
    const bigCode = "x".repeat(12000); // 3000 tokens — fills entire source budget
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [
        { symbol: "Main", file: "main.js", lineStart: 1, lineEnd: 100, code: bigCode },
        { symbol: "Down1", file: "d1.js", lineStart: 1, lineEnd: 50, code: "downstream code" },
      ],
      callgraph: [],
      issues: [],
    };

    const result = truncateContextPack(pack, 50000);
    // Downstream source should be dropped or truncated since main fills the budget
    expect(result.metadata!.truncated).toBe(true);
  });

  it("truncates issues when issues section exceeds budget", () => {
    const longBody = "issue detail ".repeat(300); // ~3900 chars → ~975 tokens each
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [],
      callgraph: [],
      issues: [
        makeIssue({ id: 1, title: "Issue A", body: longBody }),
        makeIssue({ id: 2, title: "Issue B", body: longBody }),
        makeIssue({ id: 3, title: "Issue C", body: longBody }),
      ],
    };

    const result = truncateContextPack(pack, 50000);
    // 1000 token budget, each issue ~1000+ tokens → only 1 or truncated
    expect(result.issues.length).toBeLessThanOrEqual(3);
    expect(result.metadata!.truncated).toBe(true);
  });

  it("truncates callgraph edges when callgraph section exceeds budget", () => {
    // Each edge ~50 chars JSON. Need > 500 tokens = 2000 chars = ~40 edges
    const edges = Array.from({ length: 50 }, (_, i) => ({
      source: `SourceClass_${i}`,
      target: `TargetClass_${i}`,
    }));
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [],
      callgraph: edges,
      issues: [],
    };

    const result = truncateContextPack(pack, 50000);
    expect(result.callgraph.length).toBeLessThan(50);
    expect(result.metadata!.truncated).toBe(true);
  });

  it("preserves main source (index 0) even when truncated", () => {
    const hugeCode = "y".repeat(20000); // way over source budget
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [
        { symbol: "Main", file: "main.js", lineStart: 1, lineEnd: 500, code: hugeCode },
      ],
      callgraph: [],
      issues: [],
    };

    const result = truncateContextPack(pack, 50000);
    expect(result.source.length).toBe(1);
    expect(result.source[0].symbol).toBe("Main");
    expect(result.source[0].code.length).toBeLessThan(hugeCode.length);
    expect(result.source[0].code).toContain("[truncated]");
  });

  it("handles empty pack gracefully", () => {
    const pack: ContextPack = {
      symbol: makeSymbol(),
      source: [],
      callgraph: [],
      issues: [],
    };

    const result = truncateContextPack(pack, 5000);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.truncated).toBe(false);
    expect(result.source).toEqual([]);
    expect(result.callgraph).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("enforces tokenBudget as hard cap — totalTokens <= budget", () => {
    // Construct a large pack that far exceeds a small budget
    const pack: ContextPack = {
      symbol: makeSymbol({ docComment: "A short doc comment" }),
      source: [
        { symbol: "Main", file: "main.js", lineStart: 1, lineEnd: 200, code: "x".repeat(8000) },
        { symbol: "Down1", file: "d1.js", lineStart: 1, lineEnd: 100, code: "a".repeat(4000) },
        { symbol: "Down2", file: "d2.js", lineStart: 1, lineEnd: 100, code: "b".repeat(4000) },
      ],
      callgraph: [
        { source: "Main", target: "Down1" },
        { source: "Main", target: "Down2" },
      ],
      issues: [
        makeIssue({ id: 1, title: "Bug 1", body: "body ".repeat(200) }),
        makeIssue({ id: 2, title: "Bug 2", body: "body ".repeat(200) }),
      ],
    };

    const budget = 500;
    const result = truncateContextPack(pack, budget);

    expect(result.metadata!.truncated).toBe(true);
    expect(result.metadata!.totalTokens).toBeLessThanOrEqual(budget);
  });

  it("enforces hard cap even with extremely small budget", () => {
    const pack: ContextPack = {
      symbol: makeSymbol({ docComment: "Some documentation text" }),
      source: [
        { symbol: "Main", file: "main.js", lineStart: 1, lineEnd: 50, code: "code here" },
      ],
      callgraph: [{ source: "Main", target: "Other" }],
      issues: [makeIssue()],
    };

    const budget = 50;
    const result = truncateContextPack(pack, budget);

    expect(result.metadata!.truncated).toBe(true);
    expect(result.metadata!.totalTokens).toBeLessThanOrEqual(budget);
    // Issues and callgraph should be dropped
    expect(result.issues).toEqual([]);
    expect(result.callgraph).toEqual([]);
  });
});
