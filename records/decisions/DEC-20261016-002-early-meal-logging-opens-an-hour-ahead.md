# DEC-20261016-002: Early Meal Logging Opens An Hour Ahead

Opened: 2026-10-16 12-28-44 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Amends: DEC-20261016-001

## Decision

A keepout window takes early proofs only within the hour before it opens.
Earlier than that, a photo with no item named finds nothing, and a named one
is refused as not due.

## Context

With no limit, a second photo right after lunch would finish dinner hours
ahead.

## Rationale

An hour covers eating a little early without letting one meal stand in for
the next.

## Consequences

- Hermes can still log a meal eaten up to an hour before its window.
