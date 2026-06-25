/**
 * Shader Service Implementation
 *
 * Provides shader-related operations through Shader Intelligence.
 */

import type {
  ShaderIndexBuilder,
  ShaderSymbol,
  ShaderIndexStats,
} from "@cesium-nexus/intelligence";
import type { ShaderService, ShaderFilters } from "./types.js";

export class ShaderServiceImpl implements ShaderService {
  constructor(private shaderIndexBuilder: ShaderIndexBuilder) {}

  async search(query: string, filters?: ShaderFilters): Promise<ShaderSymbol[]> {
    if (!this.shaderIndexBuilder.exists()) {
      return [];
    }

    // If we have specific filters, use them
    if (filters) {
      return this.shaderIndexBuilder.search({
        type: filters.type as any,
        relatedJsSymbol: filters.relatedJsSymbol,
        renderStage: filters.renderStage,
        file: filters.file,
      });
    }

    // Otherwise search by name pattern
    return this.shaderIndexBuilder.searchByName(query);
  }

  async getById(id: string): Promise<ShaderSymbol | null> {
    if (!this.shaderIndexBuilder.exists()) {
      return null;
    }
    return this.shaderIndexBuilder.getById(id);
  }

  async getByName(name: string): Promise<ShaderSymbol | null> {
    if (!this.shaderIndexBuilder.exists()) {
      return null;
    }
    return this.shaderIndexBuilder.getByName(name);
  }

  async getByType(type: string): Promise<ShaderSymbol[]> {
    if (!this.shaderIndexBuilder.exists()) {
      return [];
    }
    return this.shaderIndexBuilder.getByType(type as any);
  }

  async getByRenderStage(stage: string): Promise<ShaderSymbol[]> {
    if (!this.shaderIndexBuilder.exists()) {
      return [];
    }
    return this.shaderIndexBuilder.getByRenderStage(stage);
  }

  async getStats(): Promise<ShaderIndexStats> {
    if (!this.shaderIndexBuilder.exists()) {
      return {
        totalSymbols: 0,
        byType: {} as any,
        byFile: {},
        relatableSymbols: 0,
        relatedSymbols: 0,
        relationSuccessRate: 0,
      };
    }
    return this.shaderIndexBuilder.getStats();
  }
}
