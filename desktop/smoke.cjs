/**
 * 1.0 桌面安装包冒烟（只在环境变量 CA_SMOKE_DIR 存在时运行；正常用户启动永不触发）。
 * CI（windows-latest / macos-latest）装好未签名安装包后用它跑“首启 → 备份 → 恢复”，每一步截图到 CA_SMOKE_DIR，
 * 结果写 smoke.json，然后退出；卸载由 CI 脚本完成并检查。
 * 只操作本 App 自己的主界面（127.0.0.1 本机后端），不碰任何平台网页（WebContentsView 一个都不打开）。
 */
const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSmoke({ app, win, origin, safeStorage, session, dataDir }) {
  const dir = process.env.CA_SMOKE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const out = { ok: false, platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, appVersion: app.getVersion(), packaged: app.isPackaged, dataDir, steps: [] };
  const step = (name, data) => { out.steps.push({ name, at: new Date().toISOString(), ...data }); };
  const shot = async (name) => { try { win.show(); win.focus(); win.webContents.invalidate(); await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))'); } catch { /* 忽略 */ } const img = await win.webContents.capturePage(); const f = path.join(dir, `${name}.png`); fs.writeFileSync(f, img.toPNG()); return path.basename(f); };
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const write = () => fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify(out, null, 2));
  const killer = setTimeout(() => { out.error = 'timeout 150 s'; write(); app.exit(2); }, 150000);
  try {
    const health = await (await fetch(`${origin}/api/health`)).json();
    step('health', { health });
    const enc = safeStorage.isEncryptionAvailable();
    let round = false; let backend = 'os';
    try { backend = process.platform === 'linux' && safeStorage.getSelectedStorageBackend ? safeStorage.getSelectedStorageBackend() : 'os'; } catch { /* 忽略 */ }
    if (enc) round = safeStorage.decryptString(safeStorage.encryptString('smoke-roundtrip')) === 'smoke-roundtrip';
    step('safeStorage', { available: enc, roundtrip: round, backend });
    await sleep(6000);
    step('first-run', { shot: await shot('01-first-run'), title: await js('document.title') });
    await js("location.hash = '#me/backup'");
    await sleep(2500);
    step('backup-page', { shot: await shot('02-backup-page'), hasExport: await js("!!document.querySelector('[data-testid=export-zip]')") });
    const zipPath = path.join(dir, 'backup.zip');
    // 两条路取备份文件：① session will-download（真实下载）；② 钩住 <a download> 的 click，直接读 blob（CI 虚拟机里下载事件不一定触发）
    let state = 'pending';
    session.defaultSession.once('will-download', (_e, item) => { item.setSavePath(zipPath); item.once('done', (_e2, st) => { state = st; }); });
    await js(`(() => { window.__caSmoke = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download && String(this.href).startsWith('blob:')) { const name = this.download; fetch(this.href).then((r) => r.arrayBuffer()).then((ab) => { const u = new Uint8Array(ab); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); window.__caSmoke = { name, b64: btoa(bin) }; }); } return orig.call(this); }; return true; })()`);
    await js("document.querySelector('[data-testid=export-zip]').click()");
    let hooked = null;
    for (let i = 0; i < 120 && !hooked && state !== 'completed'; i++) { await sleep(500); hooked = await js('window.__caSmoke'); }
    if (hooked && !(state === 'completed' && fs.existsSync(zipPath))) { fs.writeFileSync(zipPath, Buffer.from(hooked.b64, 'base64')); if (state !== 'completed') state = 'captured-blob'; }
    const bytes = fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0;
    await sleep(800);
    step('backup-export', { state, bytes, file: hooked?.name, shot: await shot('03-backup-exported'), msg: await js("document.querySelector('[data-testid=backup-msg]')?.textContent ?? ''") });
    if (!bytes) throw new Error('备份未导出');
    const b64 = fs.readFileSync(zipPath).toString('base64');
    await js(`(async () => { const b = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0)); const f = new File([b], 'smoke-backup.zip', { type: 'application/zip' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('[data-testid=import-file]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    let msg = '';
    for (let i = 0; i < 30 && !msg; i++) { await sleep(500); msg = await js("(() => { const m = document.querySelector('[data-testid=backup-msg]')?.textContent ?? ''; const e = document.querySelector('[role=alert]')?.textContent ?? ''; return /恢复|Restored|restored/.test(m) ? m : (e ? 'ERR:' + e : ''); })()"); }
    step('backup-restore', { msg, shot: await shot('04-restored') });
    out.ok = health?.ok === true && bytes > 0 && (state === 'completed' || state === 'captured-blob') && !!msg && !msg.startsWith('ERR:') && (process.platform === 'linux' || (enc && round));
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  clearTimeout(killer);
  write();
  app.exit(out.ok ? 0 : 1);
}

module.exports = { runSmoke };
