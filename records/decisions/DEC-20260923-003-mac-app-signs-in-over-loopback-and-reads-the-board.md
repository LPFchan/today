# DEC-20260923-003: The Mac App Signs In Over Loopback and Reads the Board

Opened: 2026-09-23 18-30-00 KST
Recorded by agent: claude-opus-5-5

## Metadata

- Status: accepted
- Deciders: operator, orchestrator
- Related ids: DEC-20260923-001, LPFchan/auth cd00b05

## Decision

The Mac menu bar app signs in as its own hub OAuth client (authorization code
+ PKCE, resource `https://today.lost.plus/mcp`, scope `today`), with the
redirect caught on a loopback port (`http://127.0.0.1:<port>/callback`, RFC
8252). It reads `GET /api/board`, which the gateway now fronts as an `api`
route like `/api/watch`, so it can show your timer or any public friend's.

It ships like Parakeet: self-signed, packed by DMGMaker, updated by Sparkle 2
from a feed on the `mac-appcast` branch, with a check on every launch.

## Context

The operator asked for a CodexBar-style menu bar timer for themselves or a
friend, with onboarding, a DMG and Sparkle updates. The board already carries
everyone the caller may see; `/api/watch` carries only the caller.

## Options Considered

### Reuse the watch's QR mailbox

- No new sign-in code in the Worker.
- The Mac can open a browser itself; the mailbox's pages talk about a watch.

### A new per-person endpoint

- Narrower payload.
- Duplicates what the board already decides about visibility.

### Loopback OAuth and the board (chosen)

- The hub already accepts loopback redirects on any port; nothing new in the
  Worker; one gateway route.

## Rationale

It is the standard native-app flow and reuses the board's visibility rules
as they are.

## Consequences

- Any `today`-scoped token, the watch's included, can now read the board:
  everyone who shares publicly plus the caller.
- The appcast lives on its own branch so CI never commits to `main`.
- Release secrets `MAC_SPARKLE_PRIVATE_KEY`, `MAC_SIGNING_CERT_P12` and
  `MAC_SIGNING_CERT_PASSWORD` are on the repo; losing the Sparkle key strands
  existing installs.
