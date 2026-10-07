# today Spec

- Project: today
- Canonical repo: https://github.com/LPFchan/today
- Project id: today
- Operator: LPFchan (yeowool)
- Last updated: 2026-10-06
- Related decisions: DEC-20260923-001, DEC-20260923-003, DEC-20261005-001, DEC-20261005-002

## Thesis

A day planner that is mostly a timer. You write today's plan as plain text,
one item per line, and the page shows what you should be doing now and how
long is left. People who share their day can see each other's, so you can tell
what a friend is doing right now and when they're breaking for lunch. A Pebble
app shows your own timer on your wrist; a Mac app shows yours or a friend's in
the menu bar.

It started as marie's single-file `오늘 흐름` page (localStorage only) and
keeps its text format, its "move the first item to now?" prompt, and its
flash-and-chime when an item ends.

## Surfaces

- `today.lost.plus/` — your timer and today's list. `E` edits, `F` goes full
  screen.
- `today.lost.plus/everyone` — a shared timeline: every public person's day on
  one hour axis, with what they're doing now.
- “Today’s plan” shows auto-routine’s on/off status and a settings link to
  `/routine`. While enabled, the daily text editor, Start/Save and Clear are
  disabled; the preview and visibility controls remain available.
- `today.lost.plus/routine` — auto-routine, opt-in: a recurring
  routine (`public/routine.js` format) that writes each day's plan, with
  keepout items that lock until done. Turning it on is self-serve; turning
  it off goes through Hermes. Start-only lines end at the next line’s start;
  same-start moments retain their names and lock in listed order. Days off
  suppress locks and plan writes.
- Pebble app (`watch/`) — read-only timer for your own plan, paired by QR code.
- Mac menu bar app (`mac/`) — read-only timer for you or anyone on the board,
  signed in through the browser; notifies when anyone's next item starts;
  updates itself with Sparkle.

## Invariants

- The whole site needs a lost.plus login. The Worker never checks credentials;
  it trusts `x-lost-plus-*` headers because only the Common Auth gateway can
  reach it (no route, no workers.dev).
- Visibility is `public` (every signed-in today user sees your day) or
  `private` (only you). New people start `private`.
- The schedule text is the stored truth. `public/schedule.js` parses it in
  both the browser and the Worker; times count in minutes from the local
  midnight the plan was started from (`anchor`, epoch ms). For someone with
  auto-routine on, each new routine day overwrites the plan from the
  routine; edits to the plan stick until the next day.
- Auto-routine is per person and off by default. People without it see no
  difference anywhere. Keepout state and progress are private to their
  owner; the board shows others only the plan, and your own items carry
  when each still-owed keepout locks (`lock`, epoch ms).
- `GET /api/keepout` defaults to JSON (`now`, `day`, `keepout`). With
  `Accept: text/plain`, it returns 200 with `text/plain; charset=utf-8`:
  an empty body when free, or one newline-terminated `today keepout:` line
  naming the item and how to unlock it (Done, or its proof through Hermes),
  or its unlock time as HH:MM in the routine's timezone. Errors retain
  their JSON shape and status.
- `POST /api/routine/proof {proof, note?}` records a private `wake`, `photo`, or
  `away` proof for the current keepout that needs it, or an open keepout window.
  Optional `day` and `key` together select an item explicitly. Proofs follow
  Done's timing and action-order rules; retries preserve the first timestamp
  and note (up to 200 characters). The response includes the updated item and
  keepout. All required proofs complete an item; an `until done` condition
  still requires the button, which works only once the item's other proofs
  are in (`needs_proof`). `POST /api/routine/done` refuses items without an
  `until done` condition (`not_needed`); a Done recorded before that rule
  still counts.
  `GET /api/routine` exposes item `proofs`; keepout JSON adds `have` alongside
  the full `needs` list. `GET /api/keepout?proof=away|photo|wake` adds an eligible
  `item` (key, window start/end, required away minutes), or null when blocked,
  completed, opted out, or on a day off. Collectors count away time from that
  window's start and post with its day/key. Proofs retain today's and yesterday's
  progress only.
- `POST /api/routine/snooze {minutes: 5|30|60}` quiets a wake lock still waiting
  for its proof (`not_needed` otherwise); the lock stays. It answers like
  `GET /api/keepout`, whose keepout carries `snoozedUntil` while the snooze runs.
  Snoozing again restarts from now. The Mac alarm and dumpling's fallback stay
  silent until then; the Mac lock screen and Hermes (`wake_snooze`) offer it.
- `POST /api/routine/affordance {action, day, key?, reason, requestId}` accepts
  explicit current-day `bypass`, `skip_day` or `off` controls. Bypass uses the exact
  item key; skip_day and off omit it. skip_day ends the rest of the current routine
  day's locks and keeps the routine on; the next day locks as usual. The gateway requires the shared Today bearer token. Atomic receipts
  bind subject, day and numeric routine instance; identical retries preserve the
  receipt. Re-enable creates a fresh instance and clears live progress.
- `GET /api/routine/report?day=YYYY-MM-DD` exposes private observed routine history
  for seven elapsed days after each instance ends. Incomplete days return 409;
  absent observations are missing coverage, never fabricated misses. Reports retain
  deadline misses after late completion and distinguish bypass, skip_day, off and recovery.
- `PUT /api/routine/away {day, away, reason}` sets days off only after the current
  routine day; `GET /api/routine` lists days off from the current day onward.
- The watch and the Mac app cannot edit anything. They hold hub-issued OAuth
  tokens for resource `https://today.lost.plus/mcp`, scope `today`; the
  gateway accepts those only on `/api/watch` and `/api/board`.
- Drafts in the browser are keyed by the signed-in subject.

## Non-goals

- Editing from the watch or the Mac app.
- Friend lists, unlisted links, or per-person sharing.
- General plan history. A plan is replaced when you start a new one;
  private observed routine reporting has a bounded seven-day retention window.
