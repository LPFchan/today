# today

**[today.lost.plus](https://today.lost.plus)** — write today's plan as text, get a big timer for what you should be doing now, and see what your friends are up to. A Pebble app puts the timer on your wrist, and a Mac app puts yours or a friend's in the menu bar.

```text
09:00-10:30 Deep work
10:30 Email            ← no end time: runs until the next line
12:30-13:30 Lunch
# notes start with a hash
```

Based on marie's `오늘 흐름`.

## Pieces

| Path | What |
| --- | --- |
| `src/worker.js` | Cloudflare Worker: API, board, watch feed |
| `public/` | the web app (plain HTML/CSS/JS, no build) and the shared schedule parser |
| `migrations/` | D1 schema |
| `watch/` | Pebble app (C on the watch, PebbleKit JS on the phone) |
| `mac/` | Mac menu bar app (SwiftUI, Sparkle); see `mac/README.md` |

The Worker has no route of its own. It sits behind the lost.plus Common Auth
gateway (`LPFchan/auth`), which signs people in and passes their identity
along. See `records/SPEC.md`.

## Develop

```sh
npm install
npx wrangler d1 migrations apply today --local
npm run dev           # wrangler dev on :8787
npm run dev:gateway   # fake gateway on :8788 — open http://localhost:8788/?as=marie
npm test
```

## Deploy

```sh
npm run migrate   # D1 migrations, remote
npm run deploy    # wrangler deploy
```

The watch app builds in CI (`.github/workflows/watch.yml`) and is attached to
GitHub releases as `today.pbw`. The Mac app builds in CI too
(`.github/workflows/mac.yml`); a `mac-v*` tag publishes `Today.dmg` and its
Sparkle update. The site's download button offers both; `/download/mac`
redirects to the newest DMG in the Sparkle feed.
