import { SymbolRepo } from "./symbol-repo.js";

export interface ResolvedSymbol {
  id: string;
  displayName: string;
}

/**
 * Resolve a user-provided symbol name to a symbol ID.
 *
 * - Dotted input (e.g. "Camera.update"): exact match only, no FTS fallback.
 * - Simple name (e.g. "Viewer"): exact match first (prefer class kind), then FTS fallback.
 */
export function resolveSymbolId(
  input: string,
  symbolRepo: SymbolRepo,
): ResolvedSymbol | null {
  const hasDot = input.includes(".");

  // Try as "ClassName.methodName" first
  if (hasDot) {
    const dotIndex = input.indexOf(".");
    const className = input.substring(0, dotIndex);
    const methodName = input.substring(dotIndex + 1);

    const methodSymbols = symbolRepo.findByName(methodName);
    for (const m of methodSymbols) {
      if (m.parentClass === className) {
        return {
          id: m.id,
          displayName: `${className}.${methodName}`,
        };
      }
    }

    // Dotted name with no exact match — do NOT fallback to FTS
    return null;
  }

  // Try as a simple name (class, function, etc.)
  const symbols = symbolRepo.findByName(input);
  if (symbols.length > 0) {
    // Prefer class kind
    const cls = symbols.find((s) => s.kind === "class");
    const best = cls ?? symbols[0];
    return {
      id: best.id,
      displayName: best.parentClass
        ? `${best.parentClass}.${best.name}`
        : best.name,
    };
  }

  // Simple name with no exact match — try FTS as last resort
  const ftsResults = symbolRepo.searchFts(input, 5);
  if (ftsResults.length > 0) {
    const best = ftsResults[0];
    return {
      id: best.id,
      displayName: best.parentClass
        ? `${best.parentClass}.${best.name}`
        : best.name,
    };
  }

  return null;
}
