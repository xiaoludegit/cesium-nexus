/**
 * GLSL Scanner
 *
 * Scans GLSL files and extracts shader symbols.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { ShaderSymbol, ShaderSymbolType } from "./shader-types.js";

export class GlslScanner {
  /**
   * Scan a directory for GLSL files and extract shader symbols.
   */
  async scanDirectory(dir: string): Promise<ShaderSymbol[]> {
    const symbols: ShaderSymbol[] = [];
    await this.scanDirRecursive(dir, symbols);
    return symbols;
  }

  /**
   * Scan a single GLSL file and extract shader symbols.
   */
  scanFile(filePath: string): ShaderSymbol[] {
    const content = fs.readFileSync(filePath, "utf-8");
    return this.extractSymbols(content, filePath);
  }

  private async scanDirRecursive(
    dir: string,
    symbols: ShaderSymbol[]
  ): Promise<void> {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await this.scanDirRecursive(fullPath, symbols);
      } else if (entry.isFile() && this.isGlslFile(entry.name)) {
        const fileSymbols = this.scanFile(fullPath);
        symbols.push(...fileSymbols);
      }
    }
  }

  private isGlslFile(filename: string): boolean {
    return (
      filename.endsWith(".glsl") ||
      filename.endsWith(".glsl.js") ||
      filename.endsWith(".frag") ||
      filename.endsWith(".vert")
    );
  }

  private extractSymbols(content: string, filePath: string): ShaderSymbol[] {
    const symbols: ShaderSymbol[] = [];
    const lines = content.split("\n");

    let currentDocComment: string | undefined;
    let docCommentStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();

      // Collect doc comments
      if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
        docCommentStartLine = i;
        currentDocComment = "";
      }

      if (docCommentStartLine >= 0) {
        currentDocComment += line + "\n";
        if (trimmed.endsWith("*/")) {
          docCommentStartLine = -1;
        }
      }

      // Skip empty lines and single-line comments
      if (!trimmed || trimmed.startsWith("//")) continue;

      // Extract uniform declarations
      const uniformMatch = trimmed.match(
        /^uniform\s+(\w+)\s+(\w+)\s*(\[.*\])?\s*;/
      );
      if (uniformMatch) {
        symbols.push({
          id: `shader/${uniformMatch[2]}`,
          name: uniformMatch[2],
          type: "uniform",
          file: this.normalizePath(filePath),
          source: line,
          relatedJsSymbols: [],
          docComment: currentDocComment?.trim(),
          startLine: lineNum,
          endLine: lineNum,
        });
        currentDocComment = undefined;
        continue;
      }

      // Extract varying declarations
      const varyingMatch = trimmed.match(
        /^(in|out|varying)\s+(\w+)\s+(\w+)\s*(\[.*\])?\s*;/
      );
      if (varyingMatch) {
        symbols.push({
          id: `shader/${varyingMatch[3]}`,
          name: varyingMatch[3],
          type: "varying",
          file: this.normalizePath(filePath),
          source: line,
          relatedJsSymbols: [],
          docComment: currentDocComment?.trim(),
          startLine: lineNum,
          endLine: lineNum,
        });
        currentDocComment = undefined;
        continue;
      }

      // Extract function definitions
      const funcMatch = trimmed.match(
        /^(void|float|vec[234]|mat[234]|int|bool|sampler\w+)\s+(\w+)\s*\(/
      );
      if (funcMatch && !trimmed.startsWith("if") && !trimmed.startsWith("for")) {
        const endLine = this.findFunctionEnd(lines, i);
        symbols.push({
          id: `shader/${funcMatch[2]}`,
          name: funcMatch[2],
          type: "function",
          file: this.normalizePath(filePath),
          source: lines.slice(i, endLine).join("\n"),
          relatedJsSymbols: [],
          docComment: currentDocComment?.trim(),
          startLine: lineNum,
          endLine,
        });
        currentDocComment = undefined;
        continue;
      }

      // Extract struct definitions (handle brace on same or next line)
      const structMatch = trimmed.match(/^struct\s+(\w+)\s*\{?/);
      if (structMatch && !trimmed.includes(";")) {
        // Check if brace is on this line or next
        let braceFound = trimmed.includes("{");
        let endLine = lineNum;

        if (braceFound) {
          endLine = this.findBlockEnd(lines, i);
        } else {
          // Look for brace on next few lines
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (lines[j].trim().includes("{")) {
              braceFound = true;
              endLine = this.findBlockEnd(lines, j);
              break;
            }
          }
        }

        if (braceFound) {
          symbols.push({
            id: `shader/${structMatch[1]}`,
            name: structMatch[1],
            type: "struct",
            file: this.normalizePath(filePath),
            source: lines.slice(i, endLine).join("\n"),
            relatedJsSymbols: [],
            docComment: currentDocComment?.trim(),
            startLine: lineNum,
            endLine,
          });
          currentDocComment = undefined;
        }
        continue;
      }

      // Extract #define macros
      const defineMatch = trimmed.match(/^#define\s+(\w+)/);
      if (defineMatch) {
        symbols.push({
          id: `shader/${defineMatch[1]}`,
          name: defineMatch[1],
          type: "define",
          file: this.normalizePath(filePath),
          source: line,
          relatedJsSymbols: [],
          docComment: currentDocComment?.trim(),
          startLine: lineNum,
          endLine: lineNum,
        });
        currentDocComment = undefined;
        continue;
      }

      // Extract const declarations
      const constMatch = trimmed.match(
        /^(const)\s+(float|vec[234]|mat[234]|int|bool)\s+(\w+)\s*=/
      );
      if (constMatch) {
        symbols.push({
          id: `shader/${constMatch[3]}`,
          name: constMatch[3],
          type: "const",
          file: this.normalizePath(filePath),
          source: line,
          relatedJsSymbols: [],
          docComment: currentDocComment?.trim(),
          startLine: lineNum,
          endLine: lineNum,
        });
        currentDocComment = undefined;
        continue;
      }

      // Reset doc comment if not matched
      if (docCommentStartLine < 0 && !trimmed.startsWith("*") && !trimmed.startsWith("*/")) {
        currentDocComment = undefined;
      }
    }

    return symbols;
  }

  private findFunctionEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === "{") {
          braceCount++;
          foundOpen = true;
        } else if (char === "}") {
          braceCount--;
          if (foundOpen && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return startLine + 1;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    return this.findFunctionEnd(lines, startLine);
  }

  private normalizePath(filePath: string): string {
    // Convert absolute path to relative path from Cesium source
    const sourceMatch = filePath.match(/Source\/(.+)$/);
    if (sourceMatch) {
      return `Source/${sourceMatch[1]}`;
    }
    return path.basename(filePath);
  }
}
