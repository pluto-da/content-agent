// 扫描目录中疑似密钥的字符串；发现即以非零码退出。用于前端构建产物与发布包。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const PATTERNS = [/sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, /"(appsecret|api_key|apiKey|secret)"\s*:\s*"[A-Za-z0-9_-]{16,}"/i, /xox[baprs]-[A-Za-z0-9-]{10,}/, /AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{20,}/];
const SKIP = /node_modules|\.git|\.png$|\.jpg$|\.ico$|\.woff2?$/;
const hits = [];
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (SKIP.test(p)) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.size < 5_000_000) { const t = readFileSync(p, 'utf8'); for (const re of PATTERNS) if (re.test(t)) hits.push(`${p}: ${re}`); }
  }
}
function scanFile(p) { const s = statSync(p); if (s.size < 5_000_000) { const t = readFileSync(p, 'utf8'); for (const re of PATTERNS) if (re.test(t)) hits.push(`${p}: ${re}`); } }
// 参数可以是目录或文件；--stdin 从标准输入读文件列表（CI：git ls-files | node scripts/scan-secrets.mjs --stdin）
const args = process.argv.slice(2);
const list = args.includes('--stdin') ? readFileSync(0, 'utf8').split('\n').filter(Boolean) : args;
for (const d of list) { if (SKIP.test(d)) continue; let st; try { st = statSync(d); } catch { continue; } if (st.isDirectory()) walk(d); else scanFile(d); }
if (hits.length) { console.error('发现疑似密钥：\n' + hits.join('\n')); process.exit(1); }
console.log('未发现疑似密钥');
