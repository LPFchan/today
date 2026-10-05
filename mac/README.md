# Today for Mac

A menu bar app that shows the time left on your current item, or a friend's
(anyone who shares their day publicly). Click it for the rest of the day and
to switch people. It posts a notification whenever anyone's next item starts
(a switch in the panel turns that off).

## How it signs in

It is an OAuth client of the auth hub: it registers a client, opens the
hub's consent page, and catches the code on a loopback port
(`http://127.0.0.1:<port>/callback`). The token is bound to
`https://today.lost.plus/mcp` with scope `today`. It reads `/api/board` and
`/api/keepout`, and marks its owner’s routine item done through
`/api/routine/done`; the gateway accepts its bearer token on these routes.
Tokens sit in
`~/Library/Application Support/today/tokens.json` (mode 600).

## Routine overlay

For someone using auto-routine, an active keepout covers every display.
The main display offers Done; the others stay dark. Closing, hiding,
switching apps, Force Quit from the menu, and ordinary Quit are blocked
while the cover is up. Done or the lock ending lifts it. Shutdown, restart
and logout stay allowed.

This is friction, not a prison: killing the process leaves a short unlocked
gap before the LaunchAgent takes over or relaunches it, targeting about one
second plus startup time (`ThrottleInterval = 1`). System Settings can still
disable the agent; macOS must approve it before recovery works.

After this Mac first sees a lock, Open at Login stays on and disabled until
sign-out. If approval is needed, the panel links to Login Items in System
Settings. Previously enabled login items migrate to the bundled agent.
Normal quits outside a lock stay quit; abnormal exits trigger recovery.

The last lock is saved beside the tokens in `today/keepout.json` and restored
before fetching, so going offline or relaunching offline does not lift it.
A successful null reply, its `until` time passing, or sign-out clears it.
Signing out also clears the persisted `enforcing` flag.

On your own Mac, a debug build accepts `--fake-keepout 30` for a 30-second
preview with no network or login-item changes; Done also ends it. This path
is absent from release builds. Do not run this preview on a shared host.

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
