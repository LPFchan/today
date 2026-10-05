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

- Phase 2 — Mac overlay:
  - Why now: the first real enforcement.
  - Dependencies: phase 1; an auth gateway route that lets the Mac app's
    `today` token mark its owner's routine items started or done (today the
    Mac app is read-only).
  - Scope: full-screen overlay over every display while keepout is due,
    showing the item and what unlocks it, with a "done" button.
    Until phase 6 lands, wake-up, meals and the outing can also complete
    with the same "done" button, so no lock can become impossible to lift
    before both proofs and bypasses exist.
  - Related ids: DEC-20261005-001
- Phase 3 — agent keepout:
  - Why now: closes the "code over SSH from another machine" gap.
  - Dependencies: phases 1–2 (the overlay's "done" button is how a keepout item ends); a token the check can use to read keepout state from any machine; operator approval of the global agent-instructions edit.
  - Scope: no new CLI. Each harness hook runs a one-line `curl` to
    `today.lost.plus/api/keepout`, which answers plain text (empty when free,
    the lock line otherwise); a lock drops the prompt before the model sees
    it, and an unreachable today lets the prompt through. Hooks: Claude Code
    `UserPromptSubmit`, Codex `hooks.json` `UserPromptSubmit`, Gemini
    `BeforeAgent`, OpenCode tool-call blocking; the global agent instructions
    cover harnesses without hooks. Hermes and long-running autonomous jobs
    are exempt.
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
  - Dependencies: phase 1; findmy-mcp on dumpling; an auth gateway route and
    service credential that let brief write proof results for the operator.
  - Scope: meal photos over Telegram judged by the Hermes model (meal or not,
    calorie estimate); 30+ minutes away from home via Find My; results posted
    to today to lift the lock. When Find My sees the operator leave home for
    the outing, brief starts the Roborock through python-roborock (the
    library Home Assistant uses) and checks the run finished. The Roborock
    has no schedule of its own; brief is the only thing that runs it.
  - Related ids: DEC-20261005-001
- Phase 6 — away mode and affordances:
  - Why later: bypasses matter once the lock is real.
  - Dependencies: phases 1, 4, 5 (every proof exists before the temporary
    "done" path goes away); an auth route that lets Hermes grant affordances.
  - Scope: away mode set at least a day ahead; a Hermes tool that grants one
    item for today only, or switches auto-routine off (DEC-20261005-002), with
    a guideline to weigh the request; brief reports
    misses and bypasses each morning.
  - Related ids: DEC-20261005-001
