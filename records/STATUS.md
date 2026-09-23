# today Status

## Snapshot

- Last updated: 2026-09-23
- Overall posture: `active`
- Current focus: first real use by the operator and marie, on the web, the watch and the Mac
- Highest-priority blocker: none
- Next operator decision needed: none
- Related decisions: DEC-20260923-001, DEC-20260923-002, DEC-20260923-003

## Current State Summary

today.lost.plus is live behind the cloud Common Auth gateway: the `today`
Worker (D1 `today`), hub registry row `today.lost.plus` (alias and scope
`today`), and a proxied placeholder DNS record. The web app, the shared board
and the watch pairing mailbox answer in production. The Pebble app builds for
all seven platforms; pairing was checked against production up to the hub's
login page, and the QR the emulator shows decodes to the pairing link. A full
pairing needs a real account to approve it.

The Mac menu bar app is released as mac-v1.0.0 (`today.dmg` on GitHub, Sparkle
feed on the `mac-appcast` branch). On the Mac mini it launches, checks the
feed, and its sign-in reaches the hub's login page over a loopback port; a
full sign-in with an account hasn't happened yet. The gateway accepts the
`today` token on `/api/board` (LPFchan/auth cd00b05, deployed).

## Active Phases Or Tracks

### Launch

- Goal: the operator and marie use it daily, on the web and on the watch.
- Status: `in progress`
- Current work: first sign-ins; first real watch pairing.
- Exit criteria: both have paired a watch, installed the Mac app, and shared their day publicly.
- Related ids: DEC-20260923-001

## Recent Changes To Project Reality

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

- The Mac mini's Command Line Tools can't build Swift (duplicate `SwiftBridging` module).
  - Effect: the Mac app builds only on CI.
  - Owner: operator
  - Mitigation: reinstall the Command Line Tools (needs sudo).
  - Related ids: none

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

- Next: pair a real watch end to end.
  - Owner: operator
  - Trigger: watch-v1.0.0 release is up.
  - Related ids: DEC-20260923-001
