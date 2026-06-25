# ADR-002: Evidence Fusion Reasoner Architecture

**Date:** 2026-06-25
**Status:** Accepted

## Context

The original plan was to implement Migration Skill, Shader Skill, Diff Skill as independent capabilities. The alternative was to build a Reasoner that can fuse evidence from multiple sources.

## Decision

Build an Evidence Fusion Reasoner (`@cesium-nexus/reasoner`) that collects, ranks, and explains evidence from multiple sources. Skills (MCP tools) are consumers of the Reasoner.

## Consequences

### Positive
- Root cause reasoning > feature stacking
- Unified evidence collection from patterns, symbols, shaders, stages, experiences
- New Skills only need to call the Reasoner
- Reasoning capability is reusable across consumers (CLI, MCP, future UI)

### Negative
- More complex than simple pattern matching
- Evidence ranking rules need tuning

### Risks
- Ranking accuracy depends on rule quality → mitigate with human review + iteration

## Alternatives Considered

1. **Independent Skills** — rejected: creates fragmented capabilities without reasoning
2. **ML-based reasoning** — rejected: insufficient data, rule-based is sufficient for current scale
