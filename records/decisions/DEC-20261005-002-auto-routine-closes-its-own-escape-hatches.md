# DEC-20261005-002: auto-routine Closes Its Own Escape Hatches

Opened: 2026-10-05 03-20-43 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Related ids: DEC-20261005-001

## Decision

Once auto-routine is on, the page and the API refuse the ways around a lock
that don't go through Hermes:

- **Switching off needs Hermes.** `PUT /api/routine {enabled:false}` on an
  enabled routine answers `409 ask_hermes`. Until Hermes can grant it (phase
  6), an operator flips the row in D1 for a real emergency.
- **Edits apply from the next day.** While enabled, a saved routine is held as
  pending and takes over when the next day instance begins. Today's items
  never change mid-day. Edits while off apply at once.
- **Switching on mid-day owes only what's left.** Items that ended before the
  routine was switched on don't lock that day; items in progress or still
  open do, so switching off and on can't drop an open window.
- **One action at a time.** While an item holds the keepout, no other item
  can be started; locks are cleared in order.

## Context

The first live run of phase 1 showed that turning the routine off at 12:25,
or deleting the lunch line before lunch opened, skipped lunch with no record,
and that switching on at 02:10 made every earlier item of the day owed.

## Options Considered

### Block switching off and editing only during a lock

- Leaves both open between locks, which is when they'd be used.

### Route switching off through Hermes and defer edits (chosen)

- Matches DEC-20261005-001: bypasses are asked for and visible.

## Rationale

The off switch and same-day edits were self-serve bypasses one tap away,
which DEC-20261005-001 rules out. Deferring edits keeps editing free without
letting it rewrite today.

## Consequences

- The `/routine` switch is disabled once on, with a hint to ask Hermes.
- Phase 6's Hermes tool also grants switching auto-routine off.
