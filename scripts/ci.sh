#!/usr/bin/env bash
# 本地/CI 一键检查：lint → typecheck → 测试与覆盖率 → 构建 → 前端包密钥扫描 → 依赖审计
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== lint";       npx eslint .
echo "== typecheck";  npm run typecheck
echo "== test";       npm run coverage
echo "== build";      npm run build
echo "== secret scan (web/dist)"; node scripts/scan-secrets.mjs web/dist
echo "== audit";      npm audit --omit=dev --audit-level=high || { echo "依赖审计发现高危问题"; exit 1; }
echo "CI_OK"
