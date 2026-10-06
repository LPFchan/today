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

## Sequencing

### Near Term

- Phase 6 — finish the escape hatches:
  - Why now: auto-routine is live and every proof and Hermes control works; Done
    is still the temporary fallback for every item.
  - Remaining: retire Done for photo, away and wake items once the operator trusts
    the proofs in daily use; confirm the morning brief's delivery so reported
    misses and skips are acknowledged once.
  - Related ids: DEC-20261005-001, DEC-20261005-002
