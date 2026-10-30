#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${1:?Pass an absolute build output directory}"
DELIVERY="$BUILD_ROOT/delivery"
mkdir -p "$DELIVERY"
test -f "$TASK_ROOT/Web/index.html"
test -f "$TASK_ROOT/Web/guoguan2.swf"
test -f "$TASK_ROOT/Web/runtime/ruffle.js"
test -f "$TASK_ROOT/icon.png"

xcodebuild -version > "$DELIVERY/xcode-version.txt"
xcodebuild \
  -project "$TASK_ROOT/iOS/Guoguan2.xcodeproj" \
  -scheme Guoguan2 -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_ROOT/device" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  build 2>&1 | tee "$DELIVERY/device-build.log"

APP_PATH="$BUILD_ROOT/device/Build/Products/Release-iphoneos/Guoguan2.app"
test -d "$APP_PATH"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist")"
APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist")"
IPA_PATH="$DELIVERY/Guoguan2-${APP_VERSION}-build${APP_BUILD}.ipa"
mkdir -p "$BUILD_ROOT/package/Payload"
ditto "$APP_PATH" "$BUILD_ROOT/package/Payload/Guoguan2.app"
COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent \
  "$BUILD_ROOT/package/Payload" "$IPA_PATH"
cp "$TASK_ROOT/icon.png" "$DELIVERY/guoguan2-icon.png"
cp "$TASK_ROOT/Web/runtime/runtime-manifest.json" "$DELIVERY/runtime-manifest.json"
cp "$TASK_ROOT/preservation.json" "$DELIVERY/preservation.json"
python3 "$TASK_ROOT/scripts/validate_ipa.py" \
  "$IPA_PATH" \
  --preservation "$DELIVERY/preservation.json" \
  --output "$DELIVERY/ipa-metadata.json"

printf '%s\n' '{"simulatorRun":false,"reason":"Skipped at the owner request; arm64 device build and IPA integrity validation remain required."}' > "$DELIVERY/verification-scope.json"
