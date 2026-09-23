#!/bin/sh
# Builds mac/build/today.app (Apple silicon, macOS 15+). The version comes
# from the latest mac-vX.Y.Z tag; the build number is the commit count.
# Signs with $SIGN_IDENTITY, else the "today Self-Signed" certificate (see
# mac/README.md), else ad-hoc.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
app="$root/build/today.app"
version=$(git -C "$root" describe --tags --abbrev=0 --match 'mac-v*' 2>/dev/null | sed 's/^mac-v//')
version=${version:-0.0.0}
build=$(git -C "$root" rev-list --count HEAD)
identity=${SIGN_IDENTITY:-}
if [ -z "$identity" ] && security find-identity -p codesigning | grep -q '"today Self-Signed"'; then identity="today Self-Signed"; fi

swift build -c release --arch arm64 --package-path "$root"
bin=$(swift build -c release --arch arm64 --package-path "$root" --show-bin-path)

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks" "$app/Contents/Resources"
cp "$bin/Today" "$app/Contents/MacOS/Today"
ditto "$bin/Sparkle.framework" "$app/Contents/Frameworks/Sparkle.framework"
cp "$root/Resources/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>plus.lost.today</string>
  <key>CFBundleName</key><string>today</string>
  <key>CFBundleDisplayName</key><string>today</string>
  <key>CFBundleExecutable</key><string>Today</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$build</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 LPFchan</string>
  <key>SUFeedURL</key><string>https://raw.githubusercontent.com/LPFchan/today/mac-appcast/appcast.xml</string>
  <key>SUPublicEDKey</key><string>/JwbLlSd5UpZm4i3tRFUsMW+A00mNLVupVBmuwY+tVc=</string>
  <key>SUEnableAutomaticChecks</key><true/>
</dict>
</plist>
PLIST

if [ -n "$identity" ]; then
    # Inside out, as Sparkle's docs describe. A stable certificate keeps the
    # app's identity across updates, so the login item sticks.
    sign() { codesign --force --sign "$identity" "$@"; }
    fw="$app/Contents/Frameworks/Sparkle.framework/Versions/B"
    sign "$fw/XPCServices/Installer.xpc" "$fw/XPCServices/Downloader.xpc" "$fw/Autoupdate" "$fw/Updater.app"
    sign "$app/Contents/Frameworks/Sparkle.framework"
    sign "$app"
    echo "signed: $identity"
else
    codesign --force --deep --sign - "$app"
    echo "signed: ad-hoc"
fi
echo "$app ($version, build $build)"
