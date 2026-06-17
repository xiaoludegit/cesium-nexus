import {
  Project,
  SourceFile,
  Node,
  CallExpression,
  NewExpression,
  TypeChecker,
  PropertyAccessExpression,
} from "ts-morph";
import type { CallEdge, SymbolRecord } from "@cesium-nexus/shared";
import * as path from "node:path";

export interface CallGraphStats {
  filesScanned: number;
  resolvedCalls: number;
  constructCalls: number;
  staticCalls: number;
  unresolvedCalls: number;
  skippedDynamicCalls: number;
}

/**
 * Build a lookup map from symbols array.
 * Key format:
 *   - "ClassName.methodName" for methods (parentClass set)
 *   - "name" for classes, functions, enums, constants
 *
 * Strategy for top-level same-name symbols:
 *   - Prefer class kind over other kinds
 *   - If multiple classes share the same name, skip (ambiguous)
 */
export function buildSymbolMap(symbols: SymbolRecord[]): Map<string, SymbolRecord> {
  const map = new Map<string, SymbolRecord>();
  const seenTopLevel = new Map<string, SymbolRecord[]>();

  for (const sym of symbols) {
    if (sym.parentClass) {
      map.set(`${sym.parentClass}.${sym.name}`, sym);
    } else {
      const existing = seenTopLevel.get(sym.name) ?? [];
      existing.push(sym);
      seenTopLevel.set(sym.name, existing);
    }
  }

  // Process top-level: prefer class, skip if ambiguous (multiple classes)
  for (const [name, entries] of seenTopLevel) {
    const classes = entries.filter((s) => s.kind === "class");
    if (classes.length === 1) {
      map.set(name, classes[0]);
    } else if (classes.length === 0) {
      // No class — use first entry
      map.set(name, entries[0]);
    }
    // If multiple classes with same name → skip (ambiguous)
  }

  return map;
}

export class CallGraphExtractor {
  private project: Project;
  private cesiumRoot: string;

  constructor(cesiumRoot: string) {
    this.cesiumRoot = cesiumRoot;
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        target: 99, // ESNext
        module: 99, // ESNext
        moduleResolution: 3, // NodeNext
      },
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Load all files into the project for cross-file TypeChecker resolution.
   */
  loadFiles(filePaths: string[]): void {
    for (const fp of filePaths) {
      try {
        this.project.addSourceFileAtPath(fp);
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  /**
   * Extract call edges from all loaded files.
   */
  extract(
    symbolMap: Map<string, SymbolRecord>,
    onProgress?: (current: number, total: number) => void,
  ): { edges: CallEdge[]; stats: CallGraphStats } {
    const sourceFiles = this.project.getSourceFiles();
    const stats: CallGraphStats = {
      filesScanned: 0,
      resolvedCalls: 0,
      constructCalls: 0,
      staticCalls: 0,
      unresolvedCalls: 0,
      skippedDynamicCalls: 0,
    };
    const allEdges: CallEdge[] = [];
    const checker = this.project.getTypeChecker();

    // Build methodOwners: methodName → [className1, className2, ...]
    // Used for unique method name resolution fallback
    const methodOwners = new Map<string, string[]>();
    for (const [_key, sym] of symbolMap) {
      if (sym.parentClass && sym.kind === "method") {
        const owners = methodOwners.get(sym.name) ?? [];
        if (!owners.includes(sym.parentClass)) {
          owners.push(sym.parentClass);
        }
        methodOwners.set(sym.name, owners);
      }
    }

    for (const sourceFile of sourceFiles) {
      stats.filesScanned++;

      if (onProgress && stats.filesScanned % 100 === 0) {
        onProgress(stats.filesScanned, sourceFiles.length);
      }

      const edges = this.extractFromFile(sourceFile, checker, symbolMap, methodOwners, stats);
      allEdges.push(...edges);
    }

    return { edges: allEdges, stats };
  }

  private extractFromFile(
    sourceFile: SourceFile,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
    methodOwners: Map<string, string[]>,
    stats: CallGraphStats,
  ): CallEdge[] {
    const edges: CallEdge[] = [];

    // Find the enclosing class/function for each call to determine the source symbol
    sourceFile.forEachDescendant((node) => {
      if (Node.isNewExpression(node)) {
        const edge = this.resolveNewExpression(node, checker, symbolMap);
        if (edge) {
          const sourceName = this.findEnclosingSymbolName(node);
          const sourceSym = this.resolveSourceSymbol(sourceName, symbolMap);
          if (sourceSym) {
            edge.sourceId = sourceSym.id;
            edge.sourceName = sourceSym.parentClass
              ? `${sourceSym.parentClass}.${sourceSym.name}`
              : sourceSym.name;
            edges.push(edge);
            stats.resolvedCalls++;
            stats.constructCalls++;
          } else {
            stats.skippedDynamicCalls++;
          }
        } else {
          stats.unresolvedCalls++;
        }
      } else if (Node.isCallExpression(node)) {
        const result = this.resolveCallExpression(node, checker, symbolMap, methodOwners);
        if (result === "skip") {
          stats.skippedDynamicCalls++;
        } else if (result === "unresolved") {
          stats.unresolvedCalls++;
        } else if (result) {
          const sourceName = this.findEnclosingSymbolName(node);
          const sourceSym = this.resolveSourceSymbol(sourceName, symbolMap);
          if (sourceSym) {
            result.sourceId = sourceSym.id;
            result.sourceName = sourceSym.parentClass
              ? `${sourceSym.parentClass}.${sourceSym.name}`
              : sourceSym.name;
            edges.push(result);
            stats.resolvedCalls++;
            if (result.edgeType === "static_call") {
              stats.staticCalls++;
            }
          } else {
            stats.skippedDynamicCalls++;
          }
        }
      }
    });

    return edges;
  }

  /**
   * Resolve `new ClassName(args)` → construct edge
   */
  private resolveNewExpression(
    node: NewExpression,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
  ): CallEdge | null {
    const expr = node.getExpression();
    const typeName = expr.getText();

    // Try TypeChecker first
    const type = checker.getTypeAtLocation(expr);
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    const resolvedName = symbol?.getName() ?? typeName;

    const targetSym = symbolMap.get(resolvedName);
    if (targetSym) {
      return {
        sourceId: "", // filled by caller
        targetId: targetSym.id,
        sourceName: "", // filled by caller
        targetName: targetSym.name,
        edgeType: "construct",
      };
    }

    return null;
  }

  /**
   * Resolve call expressions:
   *   this.method() → call
   *   Class.method() → static_call
   *   obj.method() → call (only if TypeChecker resolves)
   *   bareFunc() → skip (not supported)
   */
  private resolveCallExpression(
    node: CallExpression,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
    methodOwners: Map<string, string[]>,
  ): CallEdge | "skip" | "unresolved" | null {
    const expr = node.getExpression();

    // Case 1: Property access — obj.method() or Class.method() or this.method()
    if (Node.isPropertyAccessExpression(expr)) {
      return this.resolvePropertyAccessCall(expr, node, checker, symbolMap, methodOwners);
    }

    // Case 2: Bare function call — update() → skip (not supported)
    if (Node.isIdentifier(expr)) {
      return "skip";
    }

    // Other complex expressions (IIFE, chained calls, etc.) → skip
    return "skip";
  }

  private resolvePropertyAccessCall(
    propAccess: PropertyAccessExpression,
    callNode: CallExpression,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
    methodOwners: Map<string, string[]>,
  ): CallEdge | "skip" | "unresolved" | null {
    const methodName = propAccess.getName();
    const objectExpr = propAccess.getExpression();
    const objectText = objectExpr.getText();

    // Case: this.method()
    if (objectText === "this") {
      return this.resolveThisMethodCall(callNode, methodName, checker, symbolMap);
    }

    // Case: Class.staticMethod() or obj.method()
    // Use TypeChecker to resolve the type of the object expression
    return this.resolveTypedMethodCall(objectExpr, methodName, checker, symbolMap, methodOwners);
  }

  /**
   * Resolve this.method() by finding the enclosing class.
   */
  private resolveThisMethodCall(
    callNode: CallExpression,
    methodName: string,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
  ): CallEdge | null {
    // Find enclosing class name
    const className = this.findEnclosingClassName(callNode);
    if (!className) return null;

    const key = `${className}.${methodName}`;
    const targetSym = symbolMap.get(key);
    if (!targetSym) return null;

    return {
      sourceId: "", // filled by caller
      targetId: targetSym.id,
      sourceName: "", // filled by caller
      targetName: key,
      edgeType: "call",
    };
  }

  /**
   * Resolve Class.method() or obj.method() using TypeChecker.
   */
  private resolveTypedMethodCall(
    objectExpr: Node,
    methodName: string,
    checker: TypeChecker,
    symbolMap: Map<string, SymbolRecord>,
    methodOwners: Map<string, string[]>,
  ): CallEdge | "unresolved" | null {
    try {
      const type = checker.getTypeAtLocation(objectExpr);
      const _objectText = objectExpr.getText();

      // Check if the object is a class constructor (static method call)
      const symbol = type.getSymbol() ?? type.getAliasSymbol();
      const typeName = symbol?.getName();

      // Try as ClassName.methodName (static or class-level method)
      if (typeName) {
        const key = `${typeName}.${methodName}`;
        const targetSym = symbolMap.get(key);
        if (targetSym) {
          // Determine if it's a static call or instance call
          const isStaticCall = this.isClassReference(objectExpr);
          return {
            sourceId: "",
            targetId: targetSym.id,
            sourceName: "",
            targetName: key,
            edgeType: isStaticCall ? "static_call" : "call",
          };
        }
      }

      // Try resolving via type properties
      const properties = type.getProperties();
      for (const prop of properties) {
        if (prop.getName() === methodName) {
          // Try to find the declaration and its class
          const declarations = prop.getDeclarations();
          if (declarations && declarations.length > 0) {
            const decl = declarations[0];
            const declFile = decl.getSourceFile().getFilePath();
            const _relativePath = path.relative(this.cesiumRoot, declFile).replace(/\\/g, "/");

            // Try to find the enclosing class of the declaration
            let declClassName: string | undefined;
            const parent = decl.getParent();
            if (parent && Node.isClassDeclaration(parent)) {
              declClassName = parent.getName() ?? undefined;
            }

            if (declClassName) {
              const key = `${declClassName}.${methodName}`;
              const targetSym = symbolMap.get(key);
              if (targetSym) {
                return {
                  sourceId: "",
                  targetId: targetSym.id,
                  sourceName: "",
                  targetName: key,
                  edgeType: "call",
                };
              }
            }
          }
        }
      }

      // Fallback: unique method name resolution
      // If only ONE class in the symbol map has this method name, resolve safely
      const owners = methodOwners.get(methodName);
      if (owners && owners.length === 1) {
        const key = `${owners[0]}.${methodName}`;
        const targetSym = symbolMap.get(key);
        if (targetSym) {
          return {
            sourceId: "",
            targetId: targetSym.id,
            sourceName: "",
            targetName: key,
            edgeType: "call",
          };
        }
      }

      return "unresolved";
    } catch {
      return "unresolved";
    }
  }

  /**
   * Check if an expression refers to a class (constructor function) — used to distinguish static vs instance calls.
   */
  private isClassReference(expr: Node): boolean {
    // If the expression is a simple identifier that starts with uppercase, it's likely a class reference
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      return /^[A-Z]/.test(name);
    }
    return false;
  }

  /**
   * Find the enclosing class or function name for a node.
   * Returns "ClassName.methodName" or "functionName" or null.
   */
  private findEnclosingSymbolName(node: Node): string | null {
    let current: Node | undefined = node.getParent();
    let _methodName: string | undefined;

    while (current) {
      // Method inside a class
      if (Node.isMethodDeclaration(current)) {
        const cls = current.getParent();
        const className = Node.isClassDeclaration(cls) ? cls.getName() : undefined;
        const name = current.getName();
        if (className && name) return `${className}.${name}`;
        if (name) return name;
      }

      // Function declaration
      if (Node.isFunctionDeclaration(current)) {
        const name = current.getName();
        if (name) return name;
      }

      // Arrow function / function expression assigned to a variable or prototype
      if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
        const parent = current.getParent();

        // Variable declaration: const foo = () => {}
        if (parent && Node.isVariableDeclaration(parent)) {
          return parent.getName();
        }

        // Binary expression: Foo.prototype.bar = function() {}
        if (parent && Node.isBinaryExpression(parent)) {
          const left = parent.getLeft();
          if (Node.isPropertyAccessExpression(left)) {
            const text = left.getText();
            const protoMatch = text.match(/^(\w+)\.prototype\.(\w+)$/);
            if (protoMatch) return `${protoMatch[1]}.${protoMatch[2]}`;
          }
        }
      }

      current = current.getParent();
    }

    return null;
  }

  /**
   * Find the enclosing class name for a node (used for this.method() resolution).
   */
  private findEnclosingClassName(node: Node): string | null {
    let current: Node | undefined = node.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        return current.getName() ?? null;
      }
      // For prototype methods: Foo.prototype.bar = function() { this.method() }
      if (Node.isFunctionExpression(current) || Node.isArrowFunction(current)) {
        const parent = current.getParent();
        if (parent && Node.isBinaryExpression(parent)) {
          const left = parent.getLeft();
          if (Node.isPropertyAccessExpression(left)) {
            const text = left.getText();
            const protoMatch = text.match(/^(\w+)\.prototype\.\w+$/);
            if (protoMatch) return protoMatch[1];
          }
        }
      }
      current = current.getParent();
    }
    return null;
  }

  /**
   * Resolve a source name (from findEnclosingSymbolName) to a SymbolRecord.
   */
  private resolveSourceSymbol(
    name: string | null,
    symbolMap: Map<string, SymbolRecord>,
  ): SymbolRecord | undefined {
    if (!name) return undefined;
    return symbolMap.get(name);
  }
}
