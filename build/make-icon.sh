#!/bin/sh
# Builds build/icon.icns (packaged app) and build/icon.png (dev Dock icon)
# from build/icon.svg. Needs rsvg-convert (`brew install librsvg`); iconutil ships with macOS.
set -e
cd "$(dirname "$0")"

rm -rf icon.iconset
mkdir icon.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "icon.iconset/icon_${s}x${s}.png"
  rsvg-convert -w "$((s * 2))" -h "$((s * 2))" icon.svg -o "icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns icon.iconset -o icon.icns
cp icon.iconset/icon_512x512@2x.png icon.png
rm -rf icon.iconset
