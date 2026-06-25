# ADR-001: Unified Intelligence Layer

**Date:** 2026-06-25
**Status:** Accepted

## Context

Phase 3 needs Version Intelligence, Shader Intelligence, and potentially more indexing capabilities in the future.

## Decision

Build a unified `@cesium-nexus/intelligence` package instead of multiple independent repos.

## Consequences

### Positive
- Avoids "20 repos" explosion
- Shared interfaces (Symbol ID, Snapshot, Diff)
- Easier to maintain cross-cutting concerns (identity, caching)
- New intelligence capabilities only need to extend the package

### Negative
- Larger package surface area
- All intelligence modules must be built together

### Risks
- Package could become too large → mitigate with clear module boundaries

## Alternatives Considered

1. **Separate repos per capability** — rejected: creates dependency management overhead
2. **Plugin architecture** — rejected: premature abstraction for 2-3 capabilities
