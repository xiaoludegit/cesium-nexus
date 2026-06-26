import type { Command } from "commander";
import { openDatabase, initSchema, CallGraphRepo, SymbolRepo, resolveSymbolId } from "@cesium-nexus/storage";
import type { CallEdge } from "@cesium-nexus/shared";
import { resolveDbPath } from "../config.js";

export function registerTraceCommand(program: Command): void {
  program
    .command("trace <symbol>")
    .description("Trace call graph for a symbol (upstream or downstream)")
    .option("--db <path>", "SQLite database path")
    .option("--depth <n>", "Max traversal depth", "2")
    .option("--direction <dir>", "Traversal direction: down or up", "down")
    .action(
      (
        symbol: string,
        opts: { db: string; depth: string; direction: string },
      ) => {
        const depth = parseInt(opts.depth, 10);
        if (!Number.isInteger(depth) || depth < 1 || depth > 10) {
          console.error("Error: --depth must be an integer between 1 and 10");
          process.exit(1);
        }

        const direction = opts.direction;
        if (direction !== "down" && direction !== "up") {
          console.error("Error: --direction must be 'down' or 'up'");
          process.exit(1);
        }

        const db = openDatabase(resolveDbPath(opts.db));
        initSchema(db);
        const callGraphRepo = new CallGraphRepo(db);
        const symbolRepo = new SymbolRepo(db);

        // Check if call_edges table has any data
        if (callGraphRepo.totalCount() === 0) {
          console.log("Call graph is empty. Run 'cesium index:symbols' first to build the call graph.");
          db.close();
          return;
        }

        // Resolve symbol name to symbol ID
        const resolvedId = resolveSymbolId(symbol, symbolRepo);
        if (!resolvedId) {
          console.log(`Symbol not found: ${symbol}`);
          db.close();
          return;
        }

        const edges =
          direction === "down"
            ? callGraphRepo.getDownstream(resolvedId.id, depth)
            : callGraphRepo.getUpstream(resolvedId.id, depth);

        if (edges.length === 0) {
          console.log(
            `No ${direction === "down" ? "downstream" : "upstream"} calls found for: ${resolvedId.displayName}`,
          );
          db.close();
          return;
        }

        // Build and print tree
        printTree(resolvedId.displayName, edges, direction, depth);

        db.close();
      },
    );
}

function printTree(
  rootName: string,
  edges: CallEdge[],
  direction: "down" | "up",
  maxDepth: number,
): void {
  // Build name-based adjacency map
  const childrenMap = new Map<
    string,
    { name: string; edgeType: string }[]
  >();

  for (const edge of edges) {
    const parentName =
      direction === "down" ? edge.sourceName : edge.targetName;
    const childName =
      direction === "down" ? edge.targetName : edge.sourceName;

    if (!childrenMap.has(parentName)) {
      childrenMap.set(parentName, []);
    }

    // Dedup: don't add duplicate child names under the same parent
    const existing = childrenMap.get(parentName)!;
    if (!existing.some((c) => c.name === childName)) {
      existing.push({ name: childName, edgeType: edge.edgeType });
    }
  }

  console.log(rootName);
  console.log("");

  const visited = new Set<string>();
  visited.add(rootName);
  renderChildren(rootName, childrenMap, visited, "", 0, maxDepth);
}

function renderChildren(
  parentName: string,
  childrenMap: Map<string, { name: string; edgeType: string }[]>,
  visited: Set<string>,
  prefix: string,
  currentDepth: number,
  maxDepth: number,
): void {
  const children = childrenMap.get(parentName);
  if (!children || children.length === 0) return;
  if (currentDepth >= maxDepth) return;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isLast = i === children.length - 1;
    const connector = isLast ? "└─ " : "├─ ";
    const childPrefix = isLast ? "   " : "│  ";

    const typeTag =
      child.edgeType === "construct"
        ? " [new]"
        : child.edgeType === "static_call"
          ? " [static]"
          : "";

    const cycleMarker = visited.has(child.name) ? " (circular)" : "";

    console.log(`${prefix}${connector}${child.name}${typeTag}${cycleMarker}`);

    if (!visited.has(child.name)) {
      visited.add(child.name);
      renderChildren(
        child.name,
        childrenMap,
        visited,
        prefix + childPrefix,
        currentDepth + 1,
        maxDepth,
      );
    }
  }
}
