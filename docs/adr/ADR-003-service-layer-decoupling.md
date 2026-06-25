# ADR-003: Service Layer Decoupling

**Date:** 2026-06-25
**Status:** Accepted

## Context

Phase 3C needs to expose Intelligence and Reasoner capabilities via MCP tools. The question was whether MCP handlers should directly use Intelligence/Reasoner, or go through an intermediary Service Layer.

## Decision

Introduce `@cesium-nexus/service` as a Service Layer between MCP/CLI and Intelligence/Reasoner.

Architecture: `MCP/CLI → Service → Intelligence/Reasoner`

## Consequences

### Positive
- Clean separation of concerns (presentation vs business logic)
- Services are testable independently of MCP protocol
- Engines are reusable across consumers (CLI, MCP, future REST API)
- Dependency injection via factory pattern

### Negative
- Additional abstraction layer
- More boilerplate code

### Risks
- Over-abstraction for simple pass-through → mitigate by keeping services thin

## Alternatives Considered

1. **Direct MCP → Intelligence** — rejected: couples MCP protocol to business logic
2. **Shared utility functions** — rejected: doesn't support dependency injection or testing isolation
