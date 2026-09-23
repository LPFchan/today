#!/bin/sh
# Packs mac/build/today.app into mac/build/today.dmg with DMGMaker
# (https://github.com/saihgupr/DMGMaker, pinned) and our background.
# Packaging/DMGMaker-v1.0.3.patch adds the --background option, as in Parakeet.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
tool="$root/build/dmgtool"
if [ ! -d "$tool" ]; then
    git clone -q --depth 1 --branch v1.0.3 https://github.com/saihgupr/DMGMaker "$tool" 2>/dev/null
    git -C "$tool" apply --unidiff-zero "$root/Packaging/DMGMaker-v1.0.3.patch"
fi
rm -f "$root/build/today.dmg"
(cd "$tool" && swift run -c release "DMG Maker" --app "$root/build/today.app" --name today \
    --background "$root/Packaging/DMGBackground.png")
test -f "$root/build/today.dmg"
echo "$root/build/today.dmg"
