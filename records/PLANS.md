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
- Preconditions: findmy-mcp running on dumpling (being built 2026-10-05).
- Earliest likely start: now.
- Related ids: DEC-20261005-001

Who owns what:

| Repo | Owns |
| --- | --- |
| today | the routine, window items, per-item status, keepout state, away mode and affordance API, web UI, Mac overlay |
| brief | proofs and alarms: wake-up audio over SSH (MacBook, then dumpling), meal photo judging with calorie estimate, Find My away-from-home check, Roborock check, reporting misses and bypasses |
| findmy-cli fork | findmy-mcp, hosted persistently on dumpling |
| setup | one shared keepout check called by every coding harness's hook, plus the line in the global agent instructions |

Product rule for every phase: routine and keepout are opt-in per person and
off by default. Users who haven't opted in (marie) see no change on the web,
the board, the watch or the Mac app.

## Sequencing

### Near Term

- Phase 0 — Roborock on its own schedule:
  - Why now: no code; set a daily run in the Roborock app during the evening outing.
  - Dependencies: none (operator, in the app).
  - Related ids: DEC-20261005-001
- Phase 1 — routine and keepout state in today:
  - Why now: everything else reads from it.
  - Dependencies: none.
  - Scope: opt-in flag; a recurring routine that becomes each day's plan;
    fixed and window items (opens, start trigger, deadline, unlock
    conditions, minimum lock time); sunset computed for Seoul; per-item
    status for today and yesterday; a keepout endpoint ("is a keepout item
    due right now, and which"); editing the routine in the web UI.
  - Related ids: DEC-20261005-001
- Phase 2 — Mac overlay:
  - Why now: the first real enforcement.
  - Dependencies: phase 1.
  - Scope: full-screen overlay over every display while keepout is due,
    showing the item and what unlocks it, with a "done" button for
    honor-system items and a "starting now" button for window items.
    Until phases 4 and 5 land, items whose proof isn't built yet (wake-up,
    meals, outing) complete with the same "done" button, so no lock can
    become impossible to lift.
  - Related ids: DEC-20261005-001
- Phase 3 — agent keepout:
  - Why now: closes the "code over SSH from another machine" gap.
  - Dependencies: phase 1; operator approval of the global agent-instructions edit.
  - Scope: one `today-keepout` check in setup; Claude Code `UserPromptSubmit`,
    Codex `hooks.json` `UserPromptSubmit`, Gemini `BeforeAgent`, OpenCode
    tool-call blocking, a zsh launch wrapper for harnesses without hooks.
    Hermes and long-running autonomous jobs are exempt.
  - Related ids: DEC-20261005-001

### Mid Term

- Phase 4 — wake-up alarm in brief:
  - Why later: needs the overlay to acknowledge against.
  - Dependencies: phases 1–2.
  - Scope: at 12:00, SSH to the MacBook, unmute, set volume, play audio until
    acknowledged; fall back to dumpling when the MacBook is unreachable.
  - Related ids: DEC-20261005-001
- Phase 5 — proofs in brief:
  - Why later: needs item status in today to write into.
  - Dependencies: phase 1; findmy-mcp on dumpling.
  - Scope: meal photos over Telegram judged by the Hermes model (meal or not,
    calorie estimate); 30+ minutes away from home via Find My; results posted
    to today to lift the lock.
  - Related ids: DEC-20261005-001
- Phase 6 — away mode and affordances:
  - Why later: bypasses matter once the lock is real.
  - Dependencies: phases 1, 5.
  - Scope: away mode set at least a day ahead; a Hermes tool that grants one
    item for today only, with a guideline to weigh the request; brief reports
    misses and bypasses each morning.
  - Related ids: DEC-20261005-001

### Deferred But Accepted

- Roborock verification in brief:
  - Why deferred: the app's own schedule covers it until a run gets missed unnoticed.
  - Revisit trigger: phase 5 done, or a missed run.
  - Related ids: DEC-20261005-001
