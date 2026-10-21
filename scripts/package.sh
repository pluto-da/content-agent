#!/usr/bin/env bash
# 生成发布包：不含 node_modules、data、dist、密钥与日志。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-../out/content-agent.zip}
mkdir -p "$(dirname "$OUT")"; rm -f "$OUT"
node scripts/scan-secrets.mjs . 
zip -qr "$OUT" . -x 'node_modules/*' '*/node_modules/*' 'data/*' '*/dist/*' 'coverage/*' '*/coverage/*' '.env' '*/.env' '.env.local' '.env.production' '*/release/*' 'mobile/android/*' 'mobile/ios/*' '*.log' 'secrets.enc.json' 'master.key'
echo "已生成 $OUT"
