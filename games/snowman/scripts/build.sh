#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${1:?Pass an absolute build output directory}"
DELIVERY="$BUILD_ROOT/delivery"
mkdir -p "$DELIVERY"
test -f "$TASK_ROOT/Web/index.html"
test -f "$TASK_ROOT/Web/snowman.swf"
test -f "$TASK_ROOT/Web/runtime/ruffle.js"
test -f "$TASK_ROOT/icon.png"

xcodebuild -version > "$DELIVERY/xcode-version.txt"
xcodebuild \
  -project "$TASK_ROOT/iOS/Snowman.xcodeproj" \
  -scheme Snowman -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_ROOT/device" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  build 2>&1 | tee "$DELIVERY/device-build.log"

APP_PATH="$BUILD_ROOT/device/Build/Products/Release-iphoneos/Snowman.app"
test -d "$APP_PATH"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist")"
APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist")"
IPA_PATH="$DELIVERY/Snowman-${APP_VERSION}-build${APP_BUILD}.ipa"
mkdir -p "$BUILD_ROOT/package/Payload"
ditto "$APP_PATH" "$BUILD_ROOT/package/Payload/Snowman.app"
COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent \
  "$BUILD_ROOT/package/Payload" "$IPA_PATH"
cp "$TASK_ROOT/icon.png" "$DELIVERY/snowman-icon.png"
cp "$TASK_ROOT/Web/runtime/runtime-manifest.json" "$DELIVERY/runtime-manifest.json"
python3 "$TASK_ROOT/scripts/validate_ipa.py" \
  "$IPA_PATH" \
  --output "$DELIVERY/ipa-metadata.json"

if [[ "${SNOWMAN_RUN_SIMULATOR:-0}" == "1" ]]; then
  python3 "$TASK_ROOT/scripts/simulator_smoke.py" \
    --project "$TASK_ROOT/iOS/Snowman.xcodeproj" \
    --build-root "$BUILD_ROOT/simulator" \
    --delivery "$DELIVERY"
else
  printf '%s\n' '{"simulatorRun":false,"reason":"Skipped at the owner request; arm64 device build and IPA integrity validation remain required."}' > "$DELIVERY/verification-scope.json"
fi
