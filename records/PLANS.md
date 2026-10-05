# today Plans

This document contains accepted future direction only.
Do not put raw brainstorms or untriaged intake here.

## Planning Rules

- Only accepted future direction belongs here.
- Plans should be specific enough to guide execution later.
- Product or architecture rationale should link to `DEC-*` records when relevant.
- When a plan becomes current truth, reflect it into `records/SPEC.md` or `records/STATUS.md` and update this file.

## Approved Directions

### Daily routine with keepout

- Outcome: the operator's day runs on a recurring routine (wake 12:00, face
  and teeth twice, two floating meals, an evening outing that starts before sunset, sleep
  at 03:00). Keepout items lock the Mac and stop coding agents until their
  proof arrives. Away mode and Hermes-granted affordances are the only ways
  around it, and the morning brief reports every miss and bypass.
- Why this is accepted: the operator asked for enforcement, not reminders;
  design and routine agreed in DEC-20261005-001.
- Expected value: regular sleep, meals, hygiene and daylight, without relying
  on willpower during hyperfocus.
- Preconditions: findmy-mcp running on dumpling (live since 2026-10-05).
- Earliest likely start: now.
- Related ids: DEC-20261005-001, DEC-20261005-003

Who owns what:

| Repo | Owns |
| --- | --- |
| today | the routine, window items, per-item status, keepout state, away mode and affordance API, web UI, Mac overlay |
| brief | proofs and alarms: wake-up audio over SSH (MacBook, then dumpling), meal photo judging with calorie estimate, Find My away-from-home check, starting the Roborock when you leave and checking it finished, reporting misses and bypasses |
| findmy-cli fork | findmy-mcp, hosted persistently on dumpling |
| setup | one shared keepout check called by every coding harness's hook, plus the line in the global agent instructions |
| auth | gateway routes and tokens for the new callers: the Mac app marking items started or done, brief posting proofs, Hermes granting affordances, the keepout check reading state |

Product rule for every phase: routine and keepout are opt-in per person and
off by default. Users who haven't opted in (marie) see no change on the web,
the board, the watch or the Mac app.

Last gate: the operator turns auto-routine on only after phases 4–6 ship, so
every lock has a working way out (proofs, Hermes bypasses, switching off)
before it binds.

## Sequencing

### Near Term

- Phase 5 — proofs in brief:
  - Why now: item status and the alarm are in place; proofs are the next way out of a lock.
  - Available foundation: Today proof storage/eligibility and the Common Auth
    bearer proof route are deployed; Find My is reachable on dumpling.
  - Remaining dependencies: verify the private home mapping and connect the landed
    private meal/nutrition implementation to trusted Telegram transport. Brief's
    vacuum evidence reporter is landed; vendor history cannot certify the exact
    room and three passes, so delivery must preserve that uncertainty.
    Mac proof-aware source also needs an operator-approved release before distribution.
  - Scope: meal photos over Telegram judged by the Hermes model (meal or not,
    calorie estimate); 30+ minutes away from home via Find My; results posted
    to today to lift the lock. When Find My sees the operator leave home for
    the outing, brief starts the Roborock through python-roborock (the
    library Home Assistant uses) and checks the run finished. The Roborock
    has no schedule of its own; brief is the only thing that runs it.
  - Related ids: DEC-20261005-001

### Mid Term

- Phase 6 — away mode and affordances:
  - Why later: bypasses matter once the lock is real.
  - Available foundation: Today's scoped affordance/report APIs and shared-token
    Common Auth routes are deployed.
  - Dependencies: phases 1, 4, 5 (every proof exists before the temporary
    "done" path goes away); tested Hermes tool wiring and confirmed report delivery.
  - Scope: days off from the calendar already ship (phase 4); a Hermes tool that grants one
    item for today only, or switches auto-routine off (DEC-20261005-002), with
    a guideline to weigh the request; brief reports
    misses and bypasses each morning.
  - Related ids: DEC-20261005-001
