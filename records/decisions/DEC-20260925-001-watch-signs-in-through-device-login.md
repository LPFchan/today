# DEC-20260925-001: The Watch Signs In Through Device Login

Opened: 2026-09-25 01-03-37 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Supersedes: DEC-20260923-001 (the `/pair` mailbox), DEC-20260923-002
- Related ids: LPFchan/auth DEC-20260924-001

## Decision

The Pebble app signs in through the hub's device login (`/api/device`) with
resource `https://today.lost.plus/mcp`. The QR on the watch is the hub's own
approval link. today's `/pair` mailbox and its `pairings` table are removed.

## Context

The hub's device login now serves devices bound to one service, handing out
only that service's access tokens (LPFchan/auth DEC-20260924-001). That is what
the mailbox did by hand, and the mailbox's OAuth refresh token kept getting
lost mid-rotation on the phone.

## Options Considered

### Keep the mailbox

- Works, but it is a second sign-in mechanism for one watch.

### Device login (chosen)

- No code in today; the hub owns the whole flow and the session lasts a year.

## Rationale

One mechanism instead of two, and today goes back to never touching sign-in.

## Consequences

- watch-v1.3.0 pairs through the hub; Marie re-paired on 2026-09-25.
- `/pair/*` returns 404; the gateway's public `/pair` route is removed.
