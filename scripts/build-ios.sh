#!/usr/bin/env bash
# 生成 iOS 工程（必须在 macOS + Xcode 上运行；真机安装需 Apple 开发者账号签名）。
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
(cd web && VITE_TARGET=app npx vite build)
cd mobile && npm install && { [ -d ios ] || npx cap add ios; } && npx cap sync ios && node scripts/apply-native.mjs ios && npx cap open ios
