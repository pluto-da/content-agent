#!/usr/bin/env bash
# 生成桌面安装包：Windows 用 nsis（建议在 Windows 上运行），macOS 用 dmg（必须在 macOS 上运行并签名）。
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci && npm run build
cd desktop && npm install
case "${1:-}" in win) npm run dist:win ;; mac) npm run dist:mac ;; *) npm start ;; esac
