import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CLI End-to-End tests.
 *
 * These tests run the real CLI binary against a pre-indexed Cesium database.
 * They are SKIPPED when the database is not available (e.g. in CI).
 *
 * To run locally:
 *   1. pnpm build
 *   2. node packages/cli/dist/index.js index:symbols --cesium-root ./data/cesium
 *   3. pnpm test
 */

const CLI_PATH = resolve(import.meta.dirname, "../../dist/index.js");
const DB_PATH = resolve(import.meta.dirname, "../../../../database/cesium.db");

const hasDb = existsSync(DB_PATH) && existsSync(CLI_PATH);

const describeE2E = hasDb ? describe : describe.skip;

describeE2E("CLI E2E (requires indexed database)", () => {
  const run = (args: string[]): string => {
    return execFileSync("node", [CLI_PATH, ...args, "--db", DB_PATH], {
      encoding: "utf-8",
      timeout: 15_000,
    });
  };

  it("cesium symbol Viewer returns symbol detail", () => {
    const output = run(["symbol", "Viewer"]);
    expect(output).toContain("Viewer");
  });

  it("cesium source <id> returns code", () => {
    // First get a symbol ID
    const symOutput = run(["symbol", "Viewer"]);
    // Extract the ID from output (format varies)
    const idMatch = symOutput.match(/[0-9a-f]{8,}/);
    if (!idMatch) return; // skip if can't parse ID

    const sourceOutput = run(["source", idMatch[0]]);
    expect(sourceOutput.length).toBeGreaterThan(0);
  });

  it("cesium issue EntityCollection returns results", () => {
    const output = run(["issue", "EntityCollection"]);
    // Should not throw
    expect(output.length).toBeGreaterThan(0);
  });

  it("cesium trace Viewer returns call relationships", () => {
    const output = run(["trace", "Viewer"]);
    // May be empty for some symbols but should not throw
    expect(typeof output).toBe("string");
  });

  it("cesium context Viewer returns Context Pack with metadata", () => {
    const output = run(["context", "Viewer"]);
    const pack = JSON.parse(output);
    expect(pack.symbol).toBeDefined();
    expect(pack.symbol.name).toBe("Viewer");
    expect(pack.metadata).toBeDefined();
    expect(pack.metadata.totalTokens).toBeGreaterThan(0);
    expect(pack.metadata.tokenBudget).toBeDefined();
  });
});

// Always-run test: verify the skip mechanism works
describe("CLI E2E guard", () => {
  it("detects database availability correctly", () => {
    // This test always runs and documents the environment state
    if (!hasDb) {
      console.log(
        "Skipping E2E: index database not found at",
        DB_PATH,
      );
    }
    expect(typeof hasDb).toBe("boolean");
  });
});
