/**
 * Symbol Identity - RC-002
 *
 * symbol_id = SHA1(kind + fullyQualifiedName)
 *
 * Ensures cross-version stability for symbol identification.
 */

import { createHash } from "node:crypto";
import type { SymbolIdentity } from "./types.js";

/**
 * Generate stable symbol ID from identity.
 *
 * @example
 * generateSymbolId({ kind: "method", fullyQualifiedName: "Scene.Camera.update" })
 * // => "sym/a1b2c3d4e5f6..."
 */
export function generateSymbolId(identity: SymbolIdentity): string {
  const payload = `${identity.kind}:${identity.fullyQualifiedName}`;
  const hash = createHash("sha1").update(payload).digest("hex");
  return `sym/${hash}`;
}

/**
 * Build fully qualified name from parts.
 *
 * @example
 * buildFullyQualifiedName("Scene", "Camera", "update")
 * // => "Scene.Camera.update"
 */
export function buildFullyQualifiedName(
  ...parts: (string | undefined)[]
): string {
  return parts.filter(Boolean).join(".");
}

/**
 * Parse symbol record into identity for ID generation.
 */
export function parseSymbolIdentity(
  name: string,
  kind: string,
  parentClass?: string,
  filePath?: string
): SymbolIdentity {
  const normalizedKind = normalizeKind(kind);

  // Build fully qualified name
  let fullyQualifiedName: string;

  if (parentClass) {
    // Method: ParentClass.methodName
    fullyQualifiedName = `${parentClass}.${name}`;
  } else if (filePath) {
    // Extract module path for context
    const modulePath = extractModulePath(filePath);
    fullyQualifiedName = modulePath ? `${modulePath}.${name}` : name;
  } else {
    fullyQualifiedName = name;
  }

  return {
    kind: normalizedKind,
    fullyQualifiedName,
  };
}

/**
 * Normalize kind to standard types.
 */
function normalizeKind(
  kind: string
): "class" | "function" | "method" | "enum" | "constant" {
  switch (kind.toLowerCase()) {
    case "class":
      return "class";
    case "function":
      return "function";
    case "method":
      return "method";
    case "enum":
      return "enum";
    case "constant":
    case "const":
      return "constant";
    default:
      return "function"; // fallback
  }
}

/**
 * Extract module path from file path.
 *
 * @example
 * extractModulePath("packages/engine/Source/Scene/Camera.js")
 * // => "Scene"
 */
function extractModulePath(filePath: string): string | undefined {
  // Try to extract meaningful module path
  const sourceMatch = filePath.match(/Source\/(.+?)\/[^/]+\.js$/);
  if (sourceMatch) {
    return sourceMatch[1].replace(/\//g, ".");
  }
  return undefined;
}

/**
 * Check if two symbol identities match (same logical symbol).
 */
export function identitiesMatch(
  a: SymbolIdentity,
  b: SymbolIdentity
): boolean {
  return (
    a.kind === b.kind && a.fullyQualifiedName === b.fullyQualifiedName
  );
}

/**
 * Calculate identity stability between two versions.
 *
 * Matches symbols by (kind, fullyQualifiedName) and checks if IDs are stable.
 */
export function calculateIdentityStability(
  symbolsV1: { id: string; identity: SymbolIdentity }[],
  symbolsV2: { id: string; identity: SymbolIdentity }[]
): {
  totalV1: number;
  totalV2: number;
  matched: number;
  stable: number;
  stabilityRate: number;
} {
  // Build lookup by identity key
  const v1ByIdentity = new Map<
    string,
    { id: string; identity: SymbolIdentity }
  >();
  for (const s of symbolsV1) {
    const key = `${s.identity.kind}:${s.identity.fullyQualifiedName}`;
    v1ByIdentity.set(key, s);
  }

  let matched = 0;
  let stable = 0;

  for (const s2 of symbolsV2) {
    const key = `${s2.identity.kind}:${s2.identity.fullyQualifiedName}`;
    const s1 = v1ByIdentity.get(key);

    if (s1) {
      matched++;
      if (s1.id === s2.id) {
        stable++;
      }
    }
  }

  return {
    totalV1: symbolsV1.length,
    totalV2: symbolsV2.length,
    matched,
    stable,
    stabilityRate: matched > 0 ? stable / matched : 1.0,
  };
}
