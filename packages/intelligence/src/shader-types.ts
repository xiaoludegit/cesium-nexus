/**
 * Shader Intelligence Types
 */

// Shader Symbol from GLSL files
export interface ShaderSymbol {
  id: string; // shader/{name}
  name: string; // e.g., "czm_modelVertexNormal"
  type: ShaderSymbolType;
  file: string; // Source/Shaders/**/*.glsl
  source: string; // GLSL source code
  relatedJsSymbols: string[]; // Related JS Symbol IDs
  relatedRenderStage?: string; // Related render stage (e.g., "model", "globe")
  docComment?: string; // GLSL comment
  startLine: number;
  endLine: number;
}

export type ShaderSymbolType =
  | "uniform"
  | "varying"
  | "function"
  | "struct"
  | "define"
  | "const";

// Shader Index for fast lookup
export interface ShaderIndex {
  symbols: Map<string, ShaderSymbol>;
  byName: Map<string, ShaderSymbol>;
  byType: Map<ShaderSymbolType, ShaderSymbol[]>;
  byFile: Map<string, ShaderSymbol[]>;
  byRelatedJs: Map<string, ShaderSymbol[]>;
  byRenderStage: Map<string, ShaderSymbol[]>;
}

// Shader search filters
export interface ShaderFilters {
  type?: ShaderSymbolType;
  relatedJsSymbol?: string;
  renderStage?: string;
  file?: string;
}

// Shader index statistics
export interface ShaderIndexStats {
  totalSymbols: number;
  byType: Record<ShaderSymbolType, number>;
  byFile: Record<string, number>;
  relatableSymbols: number;
  relatedSymbols: number;
  relationSuccessRate: number; // relatedSymbols / relatableSymbols ≥ 80%
}
