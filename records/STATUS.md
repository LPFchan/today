# today Status

## Snapshot

- Last updated: 2026-10-06
- Overall posture: `active`
- Current focus: first real use by the operator and marie, on the web, the watch and the Mac
- Highest-priority blocker: none
- Next operator decision needed: none
- Related decisions: DEC-20260923-003, DEC-20260925-001, DEC-20261005-001, DEC-20261005-002

## Current State Summary

today.lost.plus is live behind the cloud Common Auth gateway: the `today`
Worker (D1 `today`), hub registry row `today.lost.plus` (alias and scope
`today`), and a proxied placeholder DNS record. The web app, the shared board
answer in production. The Pebble app signs in through the hub's device login;
Marie's watch is paired and reading its plan.

The Mac menu bar app is released as mac-v1.0.0 (`today.dmg` on GitHub, Sparkle
feed on the `mac-appcast` branch). On the Mac mini it launches, checks the
feed, and its sign-in reaches the hub's login page over a loopback port; a
full sign-in with an account hasn't happened yet. The gateway accepts the
`today` token on `/api/board` (LPFchan/auth cd00b05, deployed).

## Active Phases Or Tracks

### Launch

- Goal: the operator and marie use it daily, on the web and on the watch.
- Status: `in progress`
- Current work: first sign-ins.
- Exit criteria: both have paired a watch, installed the Mac app, and shared their day publicly.
- Related ids: DEC-20260925-001

## Recent Changes To Project Reality

- 2026-10-06:
  - Change: private wake/photo/away proofs and collector eligibility are deployed; D1 migration 0005 is applied. Live bearer checks return null eligibility while the operator's routine is off and reject malformed proofs. Common Auth's proof route is reachable.
  - Why it matters: accepted proofs can satisfy routine conditions independently. Mac proof-aware alarm and unlock instructions compile and pass CI, but are not distributed in a new release. Meal ingestion, private home verification, cleaning completion reporting and Hermes bypass/off remain activation gates; Done remains the temporary override.

- 2026-10-05:
  - Change: phase 4 ships. The routine opens with `12:00 wake up` and `12:00 wash face, brush teeth`; mac-v2.1.0 rings Radial (20%→50% in 5 s) until wake up is done; brief rings dumpling when the Air can't; a 21:00 Hermes job marks calendar days off (`PUT /api/routine/away`).
  - Why it matters: waking up has its own alarm and stop button, and appointment, visit and trip days skip the routine.

- 2026-10-05:
  - Change: phases 2 and 3 of the routine plan ship. mac-v2.0.0 covers every display during keepout and holds keyboard focus; setup's harness hooks (Claude Code, Codex, Kimi) drop prompts while `/api/keepout` reports a lock, using its new plain-text answer.
  - Why it matters: a keepout now locks the Mac and the coding agents; the AGENTS.md keepout section covers harnesses without hooks.

- 2026-10-05:
  - Change: auto-routine (phase 1 of the routine plan) ships at `/routine`: the routine writes each day's plan, `/api/keepout` reports the current lock, items unlock with a Done button until proofs land.
  - Why it matters: the operator's routine runs itself; the Mac overlay (phase 2) and agent keepout (phase 3) read `/api/keepout`.

- 2026-09-25:
  - Change: the watch signs in through the hub's device login; today's `/pair` mailbox is gone.
  - Why it matters: the watch stays signed in for a year of use, and today no longer handles sign-in.
  - Related ids: DEC-20260925-001

- 2026-09-23:
  - Change: Mac menu bar app, mac-v1.0.0; the gateway's `/api/board` became an `api` route.
  - Why it matters: your or a friend's timer sits in the menu bar and updates itself.
  - Related ids: DEC-20260923-003

- 2026-09-23:
  - Change: the cloud gateway passes backend redirects through, so the pairing link is a plain 302 again.
  - Why it matters: one less workaround; coverse's sign-in cookie survives too.
  - Related ids: DEC-20260923-002
- 2026-09-23:
  - Change: first deploy; gateway routes and hub row added in LPFchan/auth.
  - Why it matters: the service exists.
  - Related ids: DEC-20260923-001

## Active Blockers And Risks

- Hangul on the watch.
  - Effect: Korean names show as boxes on stock firmware without a language pack.
  - Owner: operator
  - Mitigation: PebbleOAO carries Korean glyphs.
  - Related ids: none

## Immediate Next Steps

- Next: install today.dmg and sign in end to end.
  - Owner: operator
  - Trigger: mac-v1.0.0 is up.
  - Related ids: DEC-20260923-003

