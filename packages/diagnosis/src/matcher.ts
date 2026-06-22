import type { ProblemPattern, DiagnosisMatch } from "@cesium-nexus/shared";

const WEIGHT_ALIAS = 3;
const WEIGHT_KEYWORD = 2;
const WEIGHT_SYMPTOM = 2;
const WEIGHT_SYMBOL = 1;
const WEIGHT_CATEGORY = 1;

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "what", "which",
  "who", "whom", "this", "that", "these", "those", "am", "of", "in",
  "to", "for", "with", "on", "at", "by", "from", "as", "into", "about",
  "not", "no", "nor", "but", "and", "or", "so", "if", "then", "than",
  "when", "where", "how", "why", "all", "any", "both", "each", "few",
  "more", "most", "other", "some", "such", "only", "own", "same", "too",
  "very", "just", "also", "now", "here", "there",
]);

export function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => Boolean(t) && !STOPWORDS.has(t));
}

function matchPhrase(tokens: string[], phrase: string): boolean {
  const phraseTokens = phrase.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (phraseTokens.length === 0) return false;
  if (phraseTokens.length === 1) {
    return tokens.includes(phraseTokens[0]);
  }
  for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
    let match = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (tokens[i + j] !== phraseTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function countTokenOverlap(tokens: string[], phrases: string[], minOverlap = 1): string[] {
  const matched: string[] = [];
  for (const phrase of phrases) {
    const phraseTokens = phrase.toLowerCase().split(/[\s_-]+/).filter(Boolean);
    let overlapCount = 0;
    for (const pt of phraseTokens) {
      if (tokens.includes(pt) && !matched.includes(phrase)) {
        overlapCount++;
        if (overlapCount >= minOverlap) {
          matched.push(phrase);
          break;
        }
      }
    }
  }
  return matched;
}

export function matchProblemPatterns(
  query: string,
  patterns: ProblemPattern[],
  limit?: number,
): DiagnosisMatch[] {
  const tokens = normalizeQuery(query);
  const results: DiagnosisMatch[] = [];

  for (const pattern of patterns) {
    let score = 0;
    let hasStrong = false;
    const matchedKeywords: string[] = [];

    // 1. Alias phrase match (high weight)
    for (const alias of pattern.aliases) {
      if (matchPhrase(tokens, alias)) {
        score += WEIGHT_ALIAS;
        hasStrong = true;
        matchedKeywords.push(`alias:${alias}`);
      }
    }

    // 2. Trigger keyword match (medium weight)
    for (const kw of pattern.triggerKeywords) {
      if (tokens.includes(kw.toLowerCase())) {
        score += WEIGHT_KEYWORD;
        hasStrong = true;
        matchedKeywords.push(`keyword:${kw}`);
      }
    }

    // 3. Symptom token overlap (medium weight) — require at least 2 overlapping
    //    tokens (or all tokens if query is shorter than 2) to avoid false positives
    //    on generic single-word queries like "camera" or "tiles".
    const symptomMinOverlap = 2;
    const symptomMatches = countTokenOverlap(tokens, pattern.symptoms, symptomMinOverlap);
    if (symptomMatches.length > 0) {
      score += WEIGHT_SYMPTOM * symptomMatches.length;
      hasStrong = true;
      matchedKeywords.push(...symptomMatches.map((s) => `symptom:${s}`));
    }

    // 4. Related symbol mention (low weight — not a strong signal)
    for (const sym of pattern.relatedSymbols) {
      if (tokens.includes(sym.toLowerCase())) {
        score += WEIGHT_SYMBOL;
        matchedKeywords.push(`symbol:${sym}`);
      }
    }

    // 5. Category keyword match (low weight — not a strong signal)
    if (tokens.includes(pattern.category.toLowerCase())) {
      score += WEIGHT_CATEGORY;
      matchedKeywords.push(`category:${pattern.category}`);
    }

    if (score > 0 && hasStrong) {
      results.push({ pattern, matchedKeywords, score });
    }
  }

  results.sort((a, b) => b.score - a.score);

  if (limit != null && limit > 0) {
    return results.slice(0, limit);
  }
  return results;
}
