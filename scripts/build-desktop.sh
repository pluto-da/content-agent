#!/usr/bin/env bash
# 1.0 桌面安装包（未签名）：Windows → NSIS .exe（在 Windows 上运行），macOS → .dmg（在 macOS 上运行）。
# 没有代码签名证书：Windows 安装时 SmartScreen 显示“未知发布者”，macOS 首次打开需右键 → 打开（见 docs/desktop.md）。
# 用法：bash scripts/build-desktop.sh [win|mac]（不带参数 = 本机开发运行）
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run build
node scripts/stage-desktop.mjs
cd desktop && npm install --no-audit --no-fund
export CSC_IDENTITY_AUTO_DISCOVERY=false
case "${1:-}" in win) npm run dist:win ;; mac) npm run dist:mac ;; *) npm start ;; esac
