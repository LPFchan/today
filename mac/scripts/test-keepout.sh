#!/bin/sh
set -eu
root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
swiftc "$root/Sources/Today/Keepout.swift" "$root/Tests/KeepoutCheck.swift" -o "$tmp/check"
"$tmp/check"
