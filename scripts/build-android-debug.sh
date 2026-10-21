#!/usr/bin/env bash
# 生成 Android 调试 APK。需要：Node 22、JDK 17/21、Android SDK（含 platform 35 与 build-tools），x86_64 Linux / macOS / Windows。
# 注意：Android build-tools（aapt2）没有 linux-arm64 版本，ARM Linux 上无法直接构建。
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
(cd web && VITE_TARGET=app npx vite build)
cd mobile
npm install
[ -d android ] || npx cap add android
npx cap sync android
node scripts/apply-native.mjs android   # 本地应用插件、<queries>、FileProvider
(cd android && ./gradlew assembleDebug)
echo "APK：mobile/android/app/build/outputs/apk/debug/app-debug.apk"
