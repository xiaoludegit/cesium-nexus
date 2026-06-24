/**
 * Promoter — converts an approved ProblemCandidate into a GeneratedPattern
 * and appends it to `data/problem-kb/generated-patterns.json`.
 *
 * Per P1-4, the promoter NEVER writes `problem-patterns.json` directly.
 * The user merges `generated-patterns.json` into `problem-patterns.json`
 * after running `cesium pkb diff` to inspect the changes.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProblemCandidate, CanonicalProblem } from "../types.js";
import type { ProblemPattern, ProblemCategory } from "@cesium-nexus/shared";

/**
 * A GeneratedPattern is a draft ProblemPattern sitting in
 * `generated-patterns.json` awaiting human merge into `problem-patterns.json`.
 *
 * It carries provenance fields (candidateId, canonicalId, promotedAt) on top
 * of the standard ProblemPattern shape so reviewers can trace each entry
 * back to the mining run that produced it.
 */
export interface GeneratedPattern extends ProblemPattern {
  /** Source candidate id (e.g. "candidate/42") */
  candidateId: string;
  /** Source canonical problem id (e.g. "canonical/7") */
  canonicalId: string;
  /** Source cluster id */
  clusterId: string;
  /** ISO timestamp when this pattern was promoted */
  promotedAt: string;
  /** Source count at time of promotion (issues + forums + experiences) */
  sourceCount: number;
}

export interface PromoteInput {
  candidate: ProblemCandidate;
  canonical: CanonicalProblem;
  /** Pattern id — defaults to first draftAlias, sanitized */
  patternId?: string;
  /** Pattern name — defaults to canonical.title or first alias */
  patternName?: string;
  /** Severity — defaults to "medium" */
  severity?: "low" | "medium" | "high";
  /** Additional trigger keywords merged with draft aliases */
  triggerKeywords?: string[];
  /** Possible causes — the drafter doesn't produce these, so reviewer fills in */
  possibleCauses?: string[];
  /** Investigation steps — reviewer fills in */
  investigationSteps?: string[];
  /** Fix suggestions — reviewer fills in */
  fixSuggestions?: string[];
  /** Related stages — reviewer fills in */
  relatedStages?: string[];
}

/**
 * Promote an approved candidate into a GeneratedPattern and append it
 * (idempotently by candidateId) to the given file path.
 *
 * - If the file doesn't exist, it is created with `[entry]`.
 * - If an entry with the same `candidateId` already exists, it is replaced.
 * - If an entry has the same `id` but different `candidateId`, we throw
 *   (user must pick a different pattern id or remove the conflict first).
 *
 * Returns the entry that was written.
 */
export async function promoteCandidate(
  input: PromoteInput,
  filePath: string,
): Promise<GeneratedPattern> {
  const entry = buildGeneratedPattern(input);
  const existing = await loadGeneratedPatterns(filePath);

  const sameIdIdx = existing.findIndex((p) => p.id === entry.id);
  const sameCandidateIdx = existing.findIndex(
    (p) => p.candidateId === entry.candidateId,
  );

  if (sameIdIdx >= 0 && existing[sameIdIdx]!.candidateId !== entry.candidateId) {
    throw new Error(
      `Promotion conflict: id "${entry.id}" already used by candidate "${existing[sameIdIdx]!.candidateId}" ` +
        `(different from "${entry.candidateId}"). Pick a different patternId or remove the existing entry.`,
    );
  }

  if (sameCandidateIdx >= 0) {
    existing[sameCandidateIdx] = entry;
  } else if (sameIdIdx >= 0) {
    existing[sameIdIdx] = entry;
  } else {
    existing.push(entry);
  }

  await writeGeneratedPatterns(filePath, existing);
  return entry;
}

/**
 * Build a GeneratedPattern from promotion inputs. Pure function — no I/O.
 * Exported for unit tests.
 */
export function buildGeneratedPattern(input: PromoteInput): GeneratedPattern {
  const { candidate, canonical } = input;

  const id = input.patternId ?? sanitizeId(canonical.aliases[0] ?? candidate.draftAlias[0] ?? candidate.id);
  const name = input.patternName ?? (canonical.title || id);

  const aliases = Array.from(
    new Set([...(canonical.aliases ?? []), ...(candidate.draftAlias ?? [])]),
  );

  const triggerKeywords = Array.from(
    new Set([
      ...(candidate.draftAlias ?? []),
      ...(input.triggerKeywords ?? []),
    ]),
  );

  const category: ProblemCategory = normalizeCategory(candidate.draftCategory);

  return {
    id,
    name,
    category,
    severity: input.severity ?? "medium",
    aliases,
    triggerKeywords: triggerKeywords.length > 0 ? triggerKeywords : [id],
    symptoms:
      candidate.draftSymptoms.length > 0
        ? candidate.draftSymptoms
        : ["(no symptoms drafted — fill in before merge)"],
    possibleCauses:
      input.possibleCauses ?? ["(possible causes not yet filled by reviewer)"],
    relatedSymbols:
      candidate.draftSymbols.length > 0
        ? candidate.draftSymbols
        : ["(no symbols drafted)"],
    relatedStages: input.relatedStages ?? [],
    issueQueries: aliases.slice(0, 5),
    investigationSteps:
      input.investigationSteps ?? ["(investigation steps not yet filled by reviewer)"],
    fixSuggestions:
      input.fixSuggestions ?? ["(fix suggestions not yet filled by reviewer)"],

    candidateId: candidate.id,
    canonicalId: canonical.id,
    clusterId: candidate.clusterId,
    promotedAt: new Date().toISOString(),
    sourceCount: candidate.sourceCount,
  };
}

/**
 * Read and parse `generated-patterns.json`. Returns [] if file doesn't exist.
 */
export async function loadGeneratedPatterns(
  filePath: string,
): Promise<GeneratedPattern[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array at ${filePath}, got ${typeof parsed}`);
  }
  return parsed as GeneratedPattern[];
}

/**
 * Write generated patterns to disk, pretty-printed (2-space indent)
 * so the file is easy to review and diff manually.
 */
async function writeGeneratedPatterns(
  filePath: string,
  patterns: GeneratedPattern[],
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(patterns, null, 2) + "\n", "utf-8");
}

/**
 * Diff generated patterns against current problem-patterns.json.
 *
 * Returns:
 * - `added`: in generated but no id match in current
 * - `updated`: same id in both but content differs (shallow compare on key fields)
 * - `unchanged`: same id and content
 */
export async function diffGenerated(
  generatedPath: string,
  currentPatterns: ProblemPattern[],
): Promise<{
  added: GeneratedPattern[];
  updated: Array<{ generated: GeneratedPattern; current: ProblemPattern }>;
  unchanged: Array<{ generated: GeneratedPattern; current: ProblemPattern }>;
}> {
  const generated = await loadGeneratedPatterns(generatedPath);
  const currentById = new Map(currentPatterns.map((p) => [p.id, p]));

  const added: GeneratedPattern[] = [];
  const updated: Array<{ generated: GeneratedPattern; current: ProblemPattern }> = [];
  const unchanged: Array<{ generated: GeneratedPattern; current: ProblemPattern }> = [];

  for (const g of generated) {
    const cur = currentById.get(g.id);
    if (!cur) {
      added.push(g);
    } else if (patternsDiffer(g, cur)) {
      updated.push({ generated: g, current: cur });
    } else {
      unchanged.push({ generated: g, current: cur });
    }
  }

  return { added, updated, unchanged };
}

function patternsDiffer(g: GeneratedPattern, c: ProblemPattern): boolean {
  if (g.name !== c.name) return true;
  if (g.category !== c.category) return true;
  if (g.severity !== c.severity) return true;
  if (!arrayEqual(g.aliases, c.aliases)) return true;
  if (!arrayEqual(g.triggerKeywords, c.triggerKeywords)) return true;
  if (!arrayEqual(g.symptoms, c.symptoms)) return true;
  if (!arrayEqual(g.possibleCauses, c.possibleCauses)) return true;
  if (!arrayEqual(g.relatedSymbols, c.relatedSymbols)) return true;
  if (!arrayEqual(g.relatedStages, c.relatedStages)) return true;
  return false;
}

function arrayEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/** Lowercase + replace non-alphanumerics with underscore. */
function sanitizeId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Map draft category string to ProblemCategory union; default "debug". */
function normalizeCategory(c: string | null | undefined): ProblemCategory {
  const valid: ProblemCategory[] = [
    "debug",
    "performance",
    "rendering",
    "terrain",
    "tiles",
    "shader",
  ];
  if (!c) return "debug";
  return valid.includes(c as ProblemCategory) ? (c as ProblemCategory) : "debug";
}
