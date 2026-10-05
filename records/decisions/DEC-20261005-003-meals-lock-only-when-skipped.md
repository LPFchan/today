# DEC-20261005-003: Meals Lock Only When Skipped

Opened: 2026-10-05 09-44-46 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Amends: DEC-20261005-001 (meal 1 row)
- Related ids: DEC-20261005-002

## Decision

A meal doesn't lock while you eat. Finishing a keepout window (the meal
photo, or Done until proofs land) any time before its deadline means it never
locks. Only a meal that's still missing at the deadline locks, until it's
done. The default lunch drops its 20-minute minimum.

## Context

The operator wants to chat with friends and watch videos during meals; the
lock was meant to get them eating, not to keep them off the computer while
they eat.

## Options Considered

### No lock on meals; brief reports a skipped one

- Simplest, but nothing pushes back on skipping lunch.

### Lock only a skipped meal (chosen)

- Eating is free; not eating is what costs.

## Rationale

The pressure lands on the thing to avoid (skipping the meal) instead of on
the meal itself.

## Consequences

- An open keepout window offers Done, and the API accepts it before the
  deadline without a minimum.
- The evening outing works the same way; it still locks at sunset if you
  haven't gone.
