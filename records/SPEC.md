# today Spec

- Project: today
- Canonical repo: https://github.com/LPFchan/today
- Project id: today
- Operator: LPFchan (yeowool)
- Last updated: 2026-09-23
- Related decisions: DEC-20260923-001, DEC-20260923-003

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
  midnight the plan was started from (`anchor`, epoch ms).
- The watch and the Mac app cannot edit anything. They hold hub-issued OAuth
  tokens for resource `https://today.lost.plus/mcp`, scope `today`; the
  gateway accepts those only on `/api/watch` and `/api/board`.
- Drafts in the browser are keyed by the signed-in subject.

## Non-goals

- Editing from the watch or the Mac app.
- Friend lists, unlisted links, or per-person sharing.
- History of past days. A plan is replaced when you start a new one.
