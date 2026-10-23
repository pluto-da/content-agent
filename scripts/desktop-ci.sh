#!/usr/bin/env bash
# 1.0 CI：桌面安装包全流程——构建未签名安装包 → 静默安装 → 首启冒烟（首启 / 备份 / 恢复，截图）→ 卸载并检查 → 收集产物到 $OUT。
# 用法：bash scripts/desktop-ci.sh win|mac   （GitHub Actions windows-latest / macos-latest；OUT 默认 /tmp/desk-out）
set -uo pipefail
cd "$(dirname "$0")/.."
OS="$1"; OUT="${OUT:-$HOME/desk-out}"; mkdir -p "$OUT/smoke"
ROOT="$(pwd)"; R=0
# macOS 没有 GNU timeout：用后台 sleep + kill 实现同样的上限
tmo(){ local t=$1; shift; "$@" & local p=$!; ( sleep "$t"; kill "$p" 2>/dev/null ) & local w=$!; wait "$p"; local rc=$?; kill "$w" 2>/dev/null; return $rc; }
log(){ echo "[desktop-ci] $*" | tee -a "$OUT/desktop-ci.log"; }
bash scripts/build-desktop.sh "$OS" 2>&1 | tee "$OUT/build.log"; B=${PIPESTATUS[0]}
[ "$B" = 0 ] || { log "构建失败（$B）"; exit 1; }
ls -la desktop/release | tee -a "$OUT/desktop-ci.log"
SMOKE="$OUT/smoke"
if [ "$OS" = win ]; then
  SETUP=$(ls desktop/release/*-setup.exe | head -1); log "安装包：$SETUP"
  cp "$SETUP" "$OUT/"
  "$SETUP" /S; sleep 15
  EXE=$(find "$LOCALAPPDATA/Programs" -maxdepth 2 -iname 'content-agent.exe' 2>/dev/null | head -1)
  log "已安装：$EXE"; [ -n "$EXE" ] || { log "未找到安装后的 exe"; R=1; }
  if [ -n "$EXE" ]; then
    INST="$(dirname "$EXE")"; ls "$INST" | tee -a "$OUT/desktop-ci.log"
    CA_SMOKE_DIR="$(cygpath -w "$SMOKE" 2>/dev/null || echo "$SMOKE")" tmo 200 "$EXE"; log "冒烟退出码 $?"
    UN=$(find "$INST" -maxdepth 1 -iname 'Uninstall*.exe' | head -1); log "卸载程序：$UN"
    "$UN" /S; sleep 15
    if [ -e "$EXE" ]; then log "卸载后 exe 仍存在"; R=1; else log "卸载完成：$EXE 已删除"; echo '{"uninstalled":true}' > "$SMOKE/uninstall.json"; fi
  fi
else
  DMG=$(ls desktop/release/*.dmg | head -1); log "安装包：$DMG"
  cp "$DMG" "$OUT/"
  MNT=$(hdiutil attach -nobrowse -noverify "$DMG" | grep -o '/Volumes/.*' | head -1); log "挂载：$MNT"
  APP=$(ls -d "$MNT"/*.app | head -1); cp -R "$APP" /Applications/; hdiutil detach "$MNT" -quiet || true
  INSTALLED="/Applications/$(basename "$APP")"; BIN=$(ls "$INSTALLED/Contents/MacOS/"* | head -1); log "已安装：$INSTALLED"
  codesign -dv "$INSTALLED" 2>&1 | tee -a "$OUT/desktop-ci.log" || true
  CA_SMOKE_DIR="$SMOKE" tmo 200 "$BIN"; log "冒烟退出码 $?"
  rm -rf "$INSTALLED"; [ -e "$INSTALLED" ] && { log "卸载失败"; R=1; } || { log "卸载完成：$INSTALLED 已删除"; echo '{"uninstalled":true}' > "$SMOKE/uninstall.json"; }
fi
[ -f "$SMOKE/smoke.json" ] && cat "$SMOKE/smoke.json" | tee -a "$OUT/desktop-ci.log" || { log "没有 smoke.json"; R=1; }
grep -q '"ok": true' "$SMOKE/smoke.json" 2>/dev/null || { log "冒烟未通过"; R=1; }
rm -f "$SMOKE/backup.zip"
# GitHub 单文件上限 100 MB：安装包按 45 MB 切片（还原：cat 文件.part-* > 文件），附 sha256
cd "$OUT"; for f in *.exe *.dmg; do [ -f "$f" ] || continue; shasum -a 256 "$f" 2>/dev/null > "$f.sha256" || sha256sum "$f" > "$f.sha256"; split -b 45m "$f" "$f.part-"; rm "$f"; done
ls -la "$OUT" | tee -a "$OUT/desktop-ci.log"
exit $R
