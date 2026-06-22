import type {
  ExtractedEntity,
  RenderStage,
  ProblemPattern,
} from "@cesium-nexus/shared";
import type { SymbolRepo } from "@cesium-nexus/storage";
import { matchProblemPatterns } from "@cesium-nexus/diagnosis";

export interface ExtractEntitiesOptions {
  symbolRepo?: SymbolRepo;
  stages?: RenderStage[];
  patterns?: ProblemPattern[];
}

const VERSION_RE = /1\.\d{2,3}(?:\.\d+)?/g;
const SYMBOL_DOTTED_RE = /[A-Z][a-zA-Z]+\.[a-zA-Z]+/g;
const SYMBOL_CAPITAL_RE = /[A-Z][a-zA-Z]{2,}/g;

export function extractEntities(
  query: string,
  options?: ExtractEntitiesOptions,
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const addEntity = (type: ExtractedEntity["type"], value: string) => {
    const key = `${type}:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ type, value });
    }
  };

  // Version extraction
  const versionMatches = query.matchAll(VERSION_RE);
  for (const m of versionMatches) {
    addEntity("version", m[0]);
  }

  // Stage extraction
  if (options?.stages) {
    const queryLower = query.toLowerCase();
    for (const stage of options.stages) {
      if (queryLower.includes(stage.name.toLowerCase())) {
        addEntity("stage", stage.id);
        continue;
      }
      for (const hint of stage.symptomHints) {
        if (queryLower.includes(hint.toLowerCase())) {
          addEntity("stage", stage.id);
          break;
        }
      }
    }
  }

  // Problem pattern extraction
  if (options?.patterns) {
    const matches = matchProblemPatterns(query, options.patterns, 3);
    for (const m of matches) {
      addEntity("problem", m.pattern.id);
    }
  }

  // Symbol extraction
  const dottedMatches = query.matchAll(SYMBOL_DOTTED_RE);
  for (const m of dottedMatches) {
    const parts = m[0].split(".");
    addEntity("symbol", parts[0]);
  }

  if (options?.symbolRepo) {
    const capitalMatches = query.matchAll(SYMBOL_CAPITAL_RE);
    for (const m of capitalMatches) {
      const name = m[0];
      if (seen.has(`symbol:${name}`)) continue;
      const found = options.symbolRepo.findByName(name);
      if (found.length > 0) {
        addEntity("symbol", name);
      }
    }
  }

  return entities;
}
