# Today for Mac

A menu bar app that shows the time left on your current item, or a friend's
(anyone who shares their day publicly). Click it for the rest of the day and
to switch people.

## How it signs in

It is an OAuth client of the auth hub, like the watch, but it can open a
browser, so it skips the pairing mailbox: it registers a client, opens the
hub's consent page, and catches the code on a loopback port
(`http://127.0.0.1:<port>/callback`). The token is bound to
`https://today.lost.plus/mcp` with scope `today` and reads only `/api/board`,
an `api` route on the gateway. Tokens sit in
`~/Library/Application Support/today/tokens.json` (mode 600).

## Build

Needs Xcode 16 or its Command Line Tools on Apple silicon.

```sh
sh mac/scripts/build-app.sh   # mac/build/Today.app
sh mac/scripts/make-dmg.sh    # mac/build/Today.dmg
open mac/build/Today.app --args --rehearse-first-launch   # replay onboarding
```

`swift build --package-path mac && .build/debug/Today --snapshot DIR` (debug
builds only) draws the onboarding steps, the panel and the menu bar item to
PNGs with made-up plans. CI does this on every push that touches `mac/`
(artifact `mac`).

Artwork: `swift mac/scripts/make-icon.swift` redraws `Resources/AppIcon.icns`
from `public/icon.svg`'s shapes; `sh mac/scripts/make-dmg-background.sh`
redraws `Packaging/DMGBackground.png` from `Packaging/dmg-background.html`.

## Release

Push a tag like `mac-v1.2.0`. `.github/workflows/mac.yml` builds and signs the
app, packs `Today.dmg` with [DMGMaker](https://github.com/saihgupr/DMGMaker),
publishes a GitHub release (not marked latest, so the web app's watch
download link keeps pointing at the watch), and adds it to the
[Sparkle](https://sparkle-project.org) feed, `appcast.xml` on the
`mac-appcast` branch. The app checks that feed on every launch and daily.
Version = the tag; build number = commit count.

Repository secrets:

- `MAC_SPARKLE_PRIVATE_KEY`: signs updates; the app only installs updates
  signed with it. Its public half is `SUPublicEDKey` in `scripts/build-app.sh`.
- `MAC_SIGNING_CERT_P12`, `MAC_SIGNING_CERT_PASSWORD`: the "today Self-Signed"
  code-signing certificate (base64 .p12). Gatekeeper doesn't trust it, but
  keeping the same one keeps the app's identity across updates.

GitHub can't show secrets again; backups live in passage (folder `sparkle`,
entries `today_*`). Losing the Sparkle key means existing installs can never
update again.
