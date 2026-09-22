# DEC-20260923-001: The Watch Signs In With Hub OAuth Over a QR Mailbox

Opened: 2026-09-23 05-30-00 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Related ids: LPFchan/auth DEC-20260919-003

## Decision

The Pebble app gets its credential from the auth hub's own OAuth server
(authorization code + PKCE), bound to resource `https://today.lost.plus/mcp`
with scope `today`, and reads only `/api/watch`, which the gateway fronts as an
`api` route.

The watch cannot open a browser, so today runs a small public mailbox under
`/pair`: the phone asks for a pairing, the watch shows `/pair/<id>` as a QR
code, the scanning phone signs in and approves on the hub, the hub sends the
code back to `/pair/done`, and the watch's phone JS collects it and redeems it
with the PKCE verifier only it holds.

`/pair/<id>` answers with a page that forwards the browser (meta refresh plus
a link), not a 302: the gateway follows a backend's redirects itself, so a 302
never reaches the phone.

## Context

The operator asked for a read-only wrist timer that signs in "via QR code +
common auth". Common Auth forbids a service from validating credentials, so
today cannot mint a token of its own. The hub's device flow exists but serves
the setup CLI only, and it hands out every token the account holds.

## Options Considered

### Hub device flow

- Already exists.
- Returns the whole token bundle (or the global `*` token), far more than a
  timer needs, and is hard-wired to the `setup-auth` client.

### A today-issued watch token

- Simplest for the watch.
- today would be validating its own credential, which Common Auth rules out.

### Pebble configuration page with a pebblejs:// redirect

- The classic Pebble OAuth route.
- The hub accepts only https and loopback redirect URIs, and it is not a QR.

### Hub OAuth with a QR mailbox (chosen)

- Uses only existing hub endpoints; the gateway verifies the token like any
  other; the token is narrow and revocable.
- Costs one small public table and four routes in today.

## Rationale

It keeps every credential decision in the hub and the gateway, gives the watch
the narrowest token the hub can issue, and needs no hub change beyond a
registry row. A stolen pairing code is useless without the verifier.

## Consequences

- The hub registry row for today carries token_key `today` (auth migration
  0013), and the gateway has an `api` route for `/api/watch`.
- Refresh tokens rotate and last 30 days; a watch left unused longer shows the
  QR code again.
- Any other service that needs a backend redirect to reach the browser through
  the gateway hits the same redirect-following behavior.
