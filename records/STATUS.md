# today Status

## Snapshot

- Last updated: 2026-10-07
- Overall posture: `active`
- Current focus: the operator's first days on auto-routine; marie's first sign-ins
- Highest-priority blocker: none
- Next operator decision needed: none
- Related decisions: DEC-20260923-003, DEC-20260925-001, DEC-20261005-001, DEC-20261005-002

## Current State Summary

today.lost.plus is live behind the cloud Common Auth gateway: the `today`
Worker (D1 `today`), hub registry row `today.lost.plus` (alias and scope
`today`), and a proxied placeholder DNS record. The web app, the shared board
answer in production. The Pebble app signs in through the hub's device login;
Marie's watch is paired and reading its plan.

The Mac menu bar app is released as mac-v2.1.3 (`Today.dmg` on GitHub, signed
Sparkle feed on the `mac-appcast` branch). On the Mac mini it launches, checks the
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

- 2026-10-07:
  - Change: Done is retired for proof items (PR #21, Worker `b6177ec4`): wake, meal photo and outing items unlock only through their proofs or a Hermes skip, and a mixed `until wake, done` lock takes Done only after its wake proof. The wake alarm can be snoozed for 5, 30 or 60 minutes from the Mac lock screen or Hermes' `wake_snooze` (PR #22, migration 0008, Worker `37170515`; brief PR #19); the lock stays until the wake proof. The gateway's today POST routes are folded into one `/api/routine` route (auth PRs #7, #8). Operator-approved mac-v2.1.2 is published from `3b1e2da` (Sparkle build 63, run `37577603425`).
  - Why it matters: phase 6's last open item is confirming the morning brief's delivery. Installation of 2.1.2 on individual Macs is unverified; until a Mac updates, its lock screen still shows Done on proof locks and the server refuses it.
  - Change: the Mac panel's upcoming list marks your own keepouts with a lock glyph and the time each locks; `/api/board` carries `lock` on the owner's items only (PR #23, Worker `f5f0a704`). Operator-approved mac-v2.1.3 is published from `d57c32b` (Sparkle build 65, run `37594132332`).
  - Why it matters: the menu bar shows what the routine page shows about upcoming locks. Older Mac builds ignore the new field.

- 2026-10-06:
  - Change: the operator turned auto-routine on with the default routine. Every way out of a lock is live: wake alarm (mac-v2.1.1, dumpling fallback), meal photos and skips through Hermes (`meal_judgment`, `routine_skip`), the Find My outing proof with the room-only Roborock clean, and calendar days off. Brief's morning brief adds routine history, vacuum status and Monday's weekly time outside. The routine page no longer shows loading or turned-on status lines (PRs #18, #19).
  - Why it matters: the routine now binds. Done still satisfies every item as the temporary fallback; the first live day tests the 12:00 alarm, the sunset outing clean and a meal unlock.

- 2026-10-06:
  - Change: Hermes can skip the rest of today: the `skip_day` affordance from PR #17 (`0c556cf`) is deployed with D1 migration 0007 and Worker version `522633c5-af71-4368-84ac-c98c84823217`. Brief's single `routine_skip` Hermes tool (item, rest of today, future dates, off) is installed on Grimoire.
  - Why it matters: one conversational skip control covers every granularity; the web page still cannot skip the current day. A live Hermes request called `routine_skip` directly and got `not_due` while auto-routine is off. Activation remains gated.

- 2026-10-06:
  - Change: operator-approved mac-v2.1.1 is published from `97263fa`; its signed `Today.dmg` and Sparkle feed entry (build 54) are available. GitHub Actions run `37417299966` passed decoding/cache tests, build, UI snapshots, signing, publication and feed update.
  - Why it matters: the Mac alarm stops when wake proof arrives, and unlock instructions show only outstanding proofs. Installation on individual Macs remains unverified. Auto-routine stays off and Done remains available.

- 2026-10-06:
  - Change: the plan dialog’s compact auto-routine indicator and settings link are deployed from PR #16 (`5e7e49e`), Worker version `1fcccb24-42ad-4339-865c-5ad704782ae7`. Enabled routines grey out daily editing and disable Save/Start and Clear; preview and visibility remain available.
  - Why it matters: routine settings are reachable from the existing editor. 141 tests and desktop/mobile browser checks passed; Codex’s current-head review had no findings. Read-only production keepout is inactive. The signed-in production page was not directly verified because machine credentials are refused on browser-only routes; activation remains gated.

- 2026-10-06:
  - Change: scoped bypass/off receipts and observed routine reports are deployed from PR #15 (`cfdcb90`), with D1 migration 0006 applied and Worker version `7610bec1-7f19-4456-892e-2793fe21374e`. Common Auth's shared-token routes are deployed. Read-only production checks confirm no active keepout, 409 for an incomplete day and missing coverage for an unobserved ended day.
  - Why it matters: Today now owns durable escape receipts and reporting without inventing past activity. Hermes command/tool delivery, private home verification and an approved Mac release remain activation gates. Auto-routine remains off and Done remains the temporary override.

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

- Next: check the first live auto-routine day: the 12:00 wake alarm, the sunset outing and its room-only clean, and a meal photo unlocking lunch.
  - Owner: operator
  - Trigger: the routine day starting 2026-10-07 12:00.
  - Related ids: DEC-20261005-001

