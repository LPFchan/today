# DEC-20261018-001: Today Tokens Can Edit Their Owner's Day

Opened: 2026-10-18 13-25-00 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Amends: DEC-20260923-003

## Decision

A `today`-scoped token may call `GET /api/me`, `PUT /api/schedule` and
`PUT /api/visibility`. Each writes only the caller's own row. The watch and
the Mac app keep not using these routes. `DELETE /api/schedule` stays
browser-only.

## Context

A friend's Hermes signed itself up with the auth hub through open dynamic
client registration, got a `today` token on its owner's consent, and could
reach the board and keepout but not save a schedule.

## Options Considered

### A separate write scope

- Keeps the watch and Mac tokens read-only.
- The hub maps each service to one scope and rejects any other, so this needs
  an auth-server change.

### Widen the existing `today` scope (chosen)

- One gateway change; the official apps simply don't call the writes.

## Rationale

The writes reach only the token owner's own day plan and visibility, not the
routine, keepout or anyone else. The gateway can't tell clients apart anyway,
so a second scope would only matter once the hub can issue one.

## Consequences

- A leaked `today` token can overwrite its owner's day plan and make it public.
- Any client an admitted user consents to can do the same for that user.
