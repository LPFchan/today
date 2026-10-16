# DEC-20261016-001: Meals Can Be Logged Early

Opened: 2026-10-16 12-17-37 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Amends: DEC-20261005-003

## Decision

A keepout window takes its proofs before it opens, not only while it's open.
A meal photo sent early finishes the meal, and it never locks. A photo sent
with no item named goes to the open window, else the next one to open.

## Context

The operator ate at 12:13 and sent the photo; lunch opens at 12:30, so Hermes
had to refuse it and promise to log it later.

## Rationale

The lock exists to stop a skipped meal. A meal that has already been eaten
isn't skipped, whatever the clock says.

## Consequences

- An early photo goes to the next meal in line, so a second photo right after
  lunch would finish dinner. Hermes decides what counts as a meal.
- Done still waits for the window to open.
