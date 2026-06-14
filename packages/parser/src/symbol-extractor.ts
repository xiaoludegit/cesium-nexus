import {
  Project,
  SourceFile,
  ClassDeclaration,
  FunctionDeclaration,
  VariableDeclaration,
  MethodDeclaration,
  Node,
  SyntaxKind,
  ExpressionStatement,
  JSDoc,
  JSDocTag,
} from "ts-morph";
import type { SymbolRecord, SymbolKind } from "@cesium-nexus/shared";
import { createHash } from "node:crypto";
import * as path from "node:path";

export class SymbolExtractor {
  private project: Project;

  constructor() {
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
   * Extract all symbols from a single file.
   * @param filePath Absolute path to the .js file
   * @param cesiumRoot Absolute path to the Cesium source root (for relative path calculation)
   */
  extractFile(filePath: string, cesiumRoot: string): SymbolRecord[] {
    const relativePath = path.relative(cesiumRoot, filePath).replace(/\\/g, "/");

    let sourceFile: SourceFile;
    try {
      sourceFile = this.project.addSourceFileAtPath(filePath);
    } catch (e) {
      console.warn(`[parser] Failed to parse ${relativePath}: ${(e as Error).message}`);
      return [];
    }

    const imports = this.extractImports(sourceFile);
    const exports = this.extractExports(sourceFile);
    const symbols: SymbolRecord[] = [];

    // Track class names defined in this file (needed for prototype method detection)
    const classNames = new Set<string>();

    // 1. ES6 class declarations
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      classNames.add(name);
      symbols.push(this.buildRecord(name, "class", cls, relativePath));

      // Extract methods inside ES6 class
      for (const method of cls.getMethods()) {
        if (method.getName().startsWith("_")) continue; // skip private convention
        symbols.push(
          this.buildRecord(method.getName(), "method", method, relativePath, name),
        );
      }
    }

    // 2. Function declarations (class constructors with @alias, or standalone functions)
    for (const func of sourceFile.getFunctions()) {
      const aliasName = this.getAliasTag(func);
      if (aliasName) {
        // This is a class constructor (Cesium pattern: function Camera() with @alias Camera)
        classNames.add(aliasName);
        symbols.push(this.buildRecord(aliasName, "class", func, relativePath));
      } else if (func.isExported()) {
        const name = func.getName();
        if (name) {
          symbols.push(this.buildRecord(name, "function", func, relativePath));
        }
      }
    }

    // 2b. Collect names exported via `export default X` or `export default Object.freeze(X)`
    const defaultExportNames = new Set<string>();
    for (const stmt of sourceFile.getStatements()) {
      if (Node.isExportAssignment(stmt)) {
        const expr = stmt.getExpression();
        const text = expr.getText();
        // export default X  or  export default Object.freeze(X)  or  export default Frozen(X)
        const match = text.match(/^(?:Object\.freeze|Frozen)\((\w+)\)$|^(\w+)$/);
        if (match) {
          defaultExportNames.add(match[1] || match[2]);
        }
      }
    }

    // 3. Variable declarations (enums, constants)
    for (const stmt of sourceFile.getVariableStatements()) {
      const isExported = stmt.isExported();
      // JSDoc is on the VariableStatement, not the individual declaration
      const stmtTags = this.getJsDocTags(stmt);
      const stmtDoc = this.getJsDocText(stmt);

      for (const decl of stmt.getDeclarations()) {
        const name = decl.getName();
        const isDefaultExported = defaultExportNames.has(name);
        const effectivelyExported = isExported || isDefaultExported;

        if (stmtTags.includes("enum")) {
          symbols.push(this.buildRecord(name, "enum", stmt, relativePath));
        } else if (effectivelyExported && stmtTags.includes("constant")) {
          symbols.push(this.buildRecord(name, "constant", stmt, relativePath));
        } else if (effectivelyExported && !this.isClassAlreadyKnown(name, classNames)) {
          symbols.push(this.buildRecord(name, "constant", stmt, relativePath));
        }
      }
    }

    // 4. Prototype methods: ClassName.prototype.methodName = function() {}
    for (const stmt of sourceFile.getStatements()) {
      if (!Node.isExpressionStatement(stmt)) continue;
      const expr = stmt.getExpression();
      if (!Node.isBinaryExpression(expr)) continue;

      const left = expr.getLeft();
      if (!Node.isPropertyAccessExpression(left)) continue;

      const leftText = left.getText();
      // Match pattern: ClassName.prototype.methodName
      const protoMatch = leftText.match(/^(\w+)\.prototype\.(\w+)$/);
      if (!protoMatch) continue;

      const [, className, methodName] = protoMatch;
      if (!classNames.has(className)) continue; // only if we know this class
      if (methodName.startsWith("_")) continue; // skip private convention

      symbols.push(
        this.buildRecord(methodName, "method", stmt, relativePath, className),
      );
    }

    // Attach file-level imports/exports to all symbols
    for (const sym of symbols) {
      sym.imports = imports;
      sym.exports = exports;
    }

    // Clean up to avoid memory leaks across many files
    this.project.removeSourceFile(sourceFile);

    return symbols;
  }

  private buildRecord(
    name: string,
    kind: SymbolKind,
    node: Node,
    filePath: string,
    parentClass?: string,
  ): SymbolRecord {
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    const docComment = this.getJsDocText(node);

    return {
      id: this.generateId(filePath, name, kind),
      name,
      kind,
      filePath,
      startLine,
      endLine,
      docComment: docComment || undefined,
      exports: [],
      imports: [],
      parentClass,
    };
  }

  private generateId(filePath: string, name: string, kind: SymbolKind): string {
    return createHash("md5")
      .update(`${filePath}:${name}:${kind}`)
      .digest("hex")
      .slice(0, 12);
  }

  private extractImports(sourceFile: SourceFile): string[] {
    return sourceFile.getImportDeclarations().map((imp) => imp.getModuleSpecifierValue());
  }

  private extractExports(sourceFile: SourceFile): string[] {
    const exportedNames: string[] = [];

    // export default X
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
      exportedNames.push("default:" + (defaultExport.getName() || "anonymous"));
    }

    // export { X, Y }
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      for (const specifier of exportDecl.getNamedExports()) {
        exportedNames.push(specifier.getName());
      }
    }

    // export function/class/const (isExported check on declarations)
    for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
      if (!exportedNames.includes(name)) {
        exportedNames.push(name);
      }
    }

    return [...new Set(exportedNames)];
  }

  private getAliasTag(node: Node): string | undefined {
    if (Node.isJSDocable(node)) {
      for (const jsdoc of node.getJsDocs()) {
        for (const tag of jsdoc.getTags()) {
          try {
            const tagName = tag.getTagName?.() ?? (tag.compilerNode as any).tagName?.getText?.();
            if (tagName === "alias") {
              const comment = tag.getCommentText?.();
              return comment?.trim() || undefined;
            }
          } catch {
            // Skip malformed tags
          }
        }
      }
    }
    return undefined;
  }

  private getJsDocText(node: Node): string {
    if (!Node.isJSDocable(node)) return "";
    const docs = node.getJsDocs();
    if (docs.length === 0) return "";
    return docs
      .map((d) => d.getDescription().trim())
      .filter(Boolean)
      .join("\n");
  }

  private getJsDocTags(node: Node): string[] {
    if (!Node.isJSDocable(node)) return [];
    const tags: string[] = [];
    for (const jsdoc of node.getJsDocs()) {
      for (const tag of jsdoc.getTags()) {
        try {
          const tagName = tag.getTagName?.() ?? (tag.compilerNode as any).tagName?.getText?.();
          if (tagName) tags.push(tagName);
        } catch {
          // Skip malformed tags
        }
      }
    }
    return tags;
  }

  private isClassAlreadyKnown(name: string, classNames: Set<string>): boolean {
    return classNames.has(name);
  }
}
