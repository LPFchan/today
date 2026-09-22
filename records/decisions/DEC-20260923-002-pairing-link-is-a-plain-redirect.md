# DEC-20260923-002: The Pairing Link Is a Plain Redirect

Opened: 2026-09-23 06-15-00 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Supersedes: the forwarding-page paragraph of DEC-20260923-001
- Related ids: DEC-20260923-001, LPFchan/auth DEC-20260923-001

## Decision

`GET /pair/<id>` answers with a 302 to the hub's authorize URL. The HTML
forwarding page is gone.

## Context

DEC-20260923-001 had `/pair/<id>` forward with a meta-refresh page because the
cloud gateway followed backend redirects itself. The gateway now passes
redirects through (LPFchan/auth DEC-20260923-001, deployed 2026-09-23).

## Options Considered

### Keep the forwarding page

- Works either way.
- A workaround for a bug that no longer exists.

### Plain 302 (chosen)

- Less code; the normal way to send a browser elsewhere.

## Rationale

The workaround's only reason is gone.

## Consequences

- Production check on 2026-09-23: `/pair/<id>` returns 302 and the browser
  lands on the hub's login page.
