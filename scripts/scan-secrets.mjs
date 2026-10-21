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
for (const d of process.argv.slice(2)) walk(d);
if (hits.length) { console.error('发现疑似密钥：\n' + hits.join('\n')); process.exit(1); }
console.log('未发现疑似密钥');
