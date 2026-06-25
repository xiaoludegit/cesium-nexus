/**
 * Shader-JS Symbol Linker
 *
 * Links shader symbols to related JS symbols based on code analysis.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { ShaderSymbol } from "./shader-types.js";

interface JsSymbol {
  id: string;
  name: string;
  filePath: string;
}

// Known shader-to-JS mappings based on Cesium conventions
const KNOWN_MAPPINGS: Record<string, string[]> = {
  // Model-related shaders
  czm_modelVertexNormal: ["Model", "ModelDrawCommand"],
  czm_modelVertexPosition: ["Model", "ModelDrawCommand"],
  czm_modelColor: ["Model", "ModelDrawCommand"],
  czm_modelSilhouettePass: ["Model", "ModelSilhouette"],
  czm_pickColor: ["Scene", "pick"],
  czm_pickDepth: ["Scene", "pick"],

  // Globe-related shaders
  czm_globeDepthTexture: ["Globe", "GlobeSurfaceTile"],
  czm_globeMinimumAltitude: ["Globe"],
  czm_globeOneOverRadii: ["Globe"],

  // Camera-related
  czm_viewport: ["Camera", "Scene"],
  czm_viewportOrthographic: ["Camera"],
  czm_viewportTransformation: ["Camera"],

  // Material-related
  czm_material: ["Material", "Appearance"],
  czm_materialInput: ["Material"],
  czm_getDefaultMaterial: ["Material"],

  // Lighting
  czm_sunDirectionEC: ["Sun", "Scene"],
  czm_moonDirectionEC: ["Moon", "Scene"],
  czm_lightDirectionEC: ["Scene"],

  // Billboard/Label
  czm_billboard: ["Billboard", "BillboardCollection"],
  czm_label: ["Label", "LabelCollection"],

  // Primitive
  czm_primitive: ["Primitive"],
  czm_instanceTransform: ["Primitive", "GeometryInstance"],

  // Render targets
  czm_shadowMap: ["ShadowMap"],
  czm_frameState: ["FrameState"],
};

// Render stage mappings based on shader directory structure
const STAGE_MAPPINGS: Record<string, string> = {
  "Shaders/Builtin/Functions": "builtin",
  "Shaders/Builtin/Constants": "builtin",
  "Shaders/Builtin/Structs": "builtin",
  "Shaders/Builtin/Types": "builtin",
  "Shaders/Globe": "globe",
  "Shaders/GlobeFS": "globe",
  "Shaders/GlobeVS": "globe",
  "Shaders/Model": "model",
  "Shaders/ModelFS": "model",
  "Shaders/ModelVS": "model",
  "Shaders/Pick": "pick",
  "Shaders/Primitive": "primitive",
  "Shaders/Material": "material",
  "Shaders/PostProcess": "post-process",
  "Shaders/ShadowMap": "shadow",
  "Shaders/SkyAtmosphere": "sky",
  "Shaders/SkyBox": "sky",
  "Shaders/Sun": "sun",
  "Shaders/Moon": "moon",
  "Shaders/Billboard": "billboard",
  "Shaders/Label": "label",
  "Shaders/Point": "point",
  "Shaders/Polyline": "polyline",
};

export class ShaderJsLinker {
  /**
   * Link shader symbols to JS symbols.
   */
  async link(
    shaderSymbols: ShaderSymbol[],
    jsSymbols: JsSymbol[],
    cesiumRoot: string
  ): Promise<ShaderSymbol[]> {
    // Build JS symbol lookup by name
    const jsByName = new Map<string, JsSymbol>();
    for (const js of jsSymbols) {
      jsByName.set(js.name, js);
    }

    // Process each shader symbol
    for (const shader of shaderSymbols) {
      const related: string[] = [];

      // 1. Check known mappings
      const knownRelated = KNOWN_MAPPINGS[shader.name];
      if (knownRelated) {
        for (const name of knownRelated) {
          const js = jsByName.get(name);
          if (js) {
            related.push(js.id);
          }
        }
      }

      // 2. Check for name-based matches (e.g., czm_modelX → Model)
      if (related.length === 0) {
        const nameMatch = this.matchByName(shader.name, jsByName);
        if (nameMatch) {
          related.push(nameMatch);
        }
      }

      // 3. Check for file-based matches (shader file near JS file)
      if (related.length === 0) {
        const fileMatch = this.matchByFile(shader.file, jsSymbols, cesiumRoot);
        if (fileMatch) {
          related.push(fileMatch);
        }
      }

      // Update shader with related JS symbols
      shader.relatedJsSymbols = [...new Set(related)];

      // Determine render stage
      shader.relatedRenderStage = this.determineRenderStage(shader.file);
    }

    return shaderSymbols;
  }

  private matchByName(
    shaderName: string,
    jsByName: Map<string, JsSymbol>
  ): string | null {
    // Remove common prefixes
    const cleanName = shaderName
      .replace(/^czm_/, "")
      .replace(/^cesium_/, "");

    // Try to match with camelCase conversion
    const parts = cleanName.split(/[_A-Z]/).filter(Boolean);

    // Try common patterns
    const patterns = [
      // czm_modelVertexNormal → Model
      parts[0]?.charAt(0).toUpperCase() + parts[0]?.slice(1),
      // czm_billboard → Billboard
      cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
    ];

    for (const pattern of patterns) {
      if (pattern && jsByName.has(pattern)) {
        return jsByName.get(pattern)!.id;
      }
    }

    return null;
  }

  private matchByFile(
    shaderFile: string,
    jsSymbols: JsSymbol[],
    cesiumRoot: string
  ): string | null {
    // Extract the directory from shader file path
    const shaderDir = path.dirname(shaderFile);
    const dirName = path.basename(shaderDir);

    // Look for JS files with matching names
    for (const js of jsSymbols) {
      const jsDir = path.dirname(js.filePath);
      const jsDirName = path.basename(jsDir);

      // Same directory name suggests relationship
      if (dirName === jsDirName) {
        return js.id;
      }

      // Check if JS file name matches directory name
      const jsBaseName = path.basename(js.filePath, ".js");
      if (jsBaseName.toLowerCase() === dirName.toLowerCase()) {
        return js.id;
      }
    }

    return null;
  }

  private determineRenderStage(shaderFile: string): string | undefined {
    for (const [pathPattern, stage] of Object.entries(STAGE_MAPPINGS)) {
      if (shaderFile.includes(pathPattern)) {
        return stage;
      }
    }

    // Try to infer from directory
    const dirMatch = shaderFile.match(/Shaders\/(\w+)/);
    if (dirMatch) {
      return dirMatch[1].toLowerCase();
    }

    return undefined;
  }
}
