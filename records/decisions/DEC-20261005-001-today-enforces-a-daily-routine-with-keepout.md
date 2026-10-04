# DEC-20261005-001: today Enforces A Daily Routine With Keepout

Opened: 2026-10-05 00-43-52 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Related ids: LPFchan/brief, LPFchan/setup, LPFchan/findmy-cli

## Decision

today grows from a planner into the enforcer of a recurring daily routine.
Some routine items are **keepout**: while one is due, the Mac is covered by a
full-screen overlay and coding agents decline work, until the item's proof
arrives.

The routine (Asia/Seoul):

| When | Item | Keepout | Done when |
| --- | --- | --- | --- |
| 12:00 | wake up | yes | alarm acknowledged on the Mac |
| 12:00–12:20 | wash face, brush teeth | yes | "done" on the overlay (honor system) |
| window 12:30–14:00 | meal 1 | yes | meal photo approved, at least 20 min after it started |
| until sunset − 1h | free / code | no | |
| window sunset − 1h → sunset | evening outing (walk, usually dinner out) | yes | away from home 30+ min (Find My) **and** a meal photo |
| 02:00–02:30 | wash face, brush teeth | yes | "done" on the overlay |
| 02:30–12:00 | wind down, sleep at 03:00 | yes | the 12:00 wake-up |

Two kinds of item:

- **Fixed** items start and end at set times.
- **Window** items have an opening time, a start trigger, a deadline and an
  unlock condition. The lock starts at whichever comes first: the operator
  starts the item (taps it, sends the meal photo, or leaves home for the
  outing) or the deadline passes. The lock lifts only when every unlock condition is
  met. Meals are window items so they can float.

Ways around it, all reported in the next morning's brief:

- **Away mode** for trips and appointments, set at least a day ahead.
- **Affordance** granted by the operator's Hermes agent on request: one item,
  today only (for example "skip the walk today"). The operator cannot grant
  it to themselves from the web or the Mac app. Hermes is told to weigh the
  request rather than approve it by default.

All of this is opt-in per person and off by default. Someone who hasn't
turned it on (marie, for example) sees today exactly as before: the same
editor, timer, board, watch and Mac app, with no overlay and no routine. For
someone who has, the board shows routine items like any other plan item;
proofs, keepout state and affordances stay private to their owner.

Hermes is exempt from agent keepout; it is not used for coding, and it is the
channel for proofs and affordance requests. Long-running autonomous jobs are
exempt too.

## Context

The operator's days had collapsed into code, pass out on the sofa, repeat:
no regular sleep, skipped face washing, irregular meals, no walks, and a
robot vacuum that never got scheduled. Reminders alone don't survive
hyperfocus. The operator wants the routine enforced, with escape hatches that
take a deliberate step.

## Options Considered

### Reminders and notifications only

- Easy, and already half there (today's chime, the Mac app's notifications).
- Hyperfocus dismisses them; this is what has been failing.

### Hard lock with a self-serve bypass button

- Strong, but a button one click away gets clicked in the moment.

### Keepout with proofs, and a bypass that has to be asked for (chosen)

- The lock bites only while something is actually owed.
- Asking Hermes is a deliberate act and leaves a record.

## Rationale

Proof-based unlocks keep the lock from being arbitrary: it ends as soon as the
thing is done. Window items let meals and the outing float without losing a
deadline. Routing bypasses through Hermes and the brief keeps them possible
for sick days and trips while making them visible.

Evening outing details: dinner is usually eaten outside, so the walk and
dinner are one item. "Went outside" is 30+ minutes away from home rather than
entering the park, so restaurant trips count and routes can change. If the
operator hasn't left by sunset, the Mac locks; leaving after dark still
completes the item and lifts the lock, so the sunset lock is the pressure to
go out in daylight, not a point of no return. If the operator never leaves,
the lock holds into the night lock; affordance is the only way out (operator
choice: strict).

## Consequences

- Every change ships behind the per-person opt-in; non-routine users see no
  change in any surface.
- today gains a recurring routine, window items, per-item status, keepout
  state and an affordance API; the SPEC non-goal "no history" relaxes to
  keeping enough of yesterday for the brief to report misses.
- The Mac app gains a full-screen overlay and, for its owner's routine items
  only, a write path; the SPEC invariant that the Mac app edits nothing
  narrows accordingly. brief and Hermes also need authenticated write routes
  through the auth gateway.
- brief becomes the orchestrator of proofs: wake-up audio over SSH (MacBook
  first, dumpling as backup), meal photos judged by the Hermes model with a
  calorie estimate, Find My checks via findmy-mcp on dumpling, and Roborock
  verification.
- LPFchan/setup gains one shared keepout check that every coding harness's
  hook calls, and a line in the global agent instructions.
