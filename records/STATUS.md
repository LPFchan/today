# today Status

## Snapshot

- Last updated: 2026-09-23
- Overall posture: `active`
- Current focus: first real use by the operator and marie
- Highest-priority blocker: none
- Next operator decision needed: none
- Related decisions: DEC-20260923-001, DEC-20260923-002

## Current State Summary

today.lost.plus is live behind the cloud Common Auth gateway: the `today`
Worker (D1 `today`), hub registry row `today.lost.plus` (alias and scope
`today`), and a proxied placeholder DNS record. The web app, the shared board
and the watch pairing mailbox answer in production. The Pebble app builds for
all seven platforms; pairing was checked against production up to the hub's
login page, and the QR the emulator shows decodes to the pairing link. A full
pairing needs a real account to approve it.

## Active Phases Or Tracks

### Launch

- Goal: the operator and marie use it daily, on the web and on the watch.
- Status: `in progress`
- Current work: first sign-ins; first real watch pairing.
- Exit criteria: both have paired a watch and shared their day publicly.
- Related ids: DEC-20260923-001

## Recent Changes To Project Reality

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

- Next: pair a real watch end to end.
  - Owner: operator
  - Trigger: watch-v1.0.0 release is up.
  - Related ids: DEC-20260923-001
