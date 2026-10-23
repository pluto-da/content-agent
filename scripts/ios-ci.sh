#!/usr/bin/env bash
# 1.0 CI（macos-latest）：生成 Capacitor iOS 工程 → 写入原生插件（LocalApps / SecureKeys = ios-keychain）→ 无签名模拟器构建（验证能编译）
# → 尽力在模拟器里安装、启动并截图（失败不影响编译结论）。TestFlight / 真机需要 Apple 开发者账号，见 docs/ios.md。
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-$HOME/ios-out}"; mkdir -p "$OUT"
set -e
npm ci
(cd web && VITE_TARGET=app npx vite build)
cd mobile
npm install --no-audit --no-fund
[ -d ios ] || npx cap add ios
npx cap sync ios
gem list -i xcodeproj >/dev/null 2>&1 || gem install --user-install xcodeproj || sudo gem install xcodeproj
export PATH="$(ruby -e 'print Gem.user_dir')/bin:$PATH"
node scripts/apply-native.mjs ios 2>&1 | tee "$OUT/apply-native.log"
cd ios/App
if [ -f Podfile ] && [ ! -d Pods ]; then pod install; fi
if [ -d App.xcworkspace ]; then WS=(-workspace App.xcworkspace); else WS=(-project App.xcodeproj); fi
set +e
xcodebuild "${WS[@]}" -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$PWD/build" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build > "$OUT/xcodebuild.log" 2>&1
X=$?
tail -40 "$OUT/xcodebuild.log"
grep -E "SecureKeysPlugin|LocalAppsPlugin|MainViewController" "$OUT/xcodebuild.log" | grep -c "Compiling\|SwiftCompile" > "$OUT/swift-compiled.txt" || true
APP=$(ls -d build/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1)
V=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Info.plist" 2>/dev/null); C=$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Info.plist" 2>/dev/null)
echo "{\"xcodebuild\": $X, \"app\": \"$(basename "$APP")\", \"version\": \"$V\", \"build\": \"$C\", \"swiftFilesCompiled\": $(cat "$OUT/swift-compiled.txt" 2>/dev/null || echo 0)}" > "$OUT/ios-build.json"
cat "$OUT/ios-build.json"
if [ "$X" = 0 ] && [ -n "$APP" ]; then
  UDID=$(xcrun simctl list devices available -j | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next((x['udid'] for k,v in d.items() if 'iOS' in k for x in v if x['name'].startswith('iPhone')), ''))")
  if [ -n "$UDID" ]; then
    xcrun simctl boot "$UDID" || true; xcrun simctl bootstatus "$UDID" -b || true
    xcrun simctl install "$UDID" "$APP" && xcrun simctl launch "$UDID" local.contentagent.app && sleep 25 && xcrun simctl io "$UDID" screenshot "$OUT/ios-sim-first-run.png" || echo "模拟器截图未完成（不影响编译结论）"
  fi
fi
exit $X
