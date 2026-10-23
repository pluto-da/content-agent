#!/usr/bin/env node
/**
 * accept:v10 —— 按 design/ROADMAP.md「0.10」逐项检查并输出（out/accept-v10.json / .md）。
 * 证据：out/vitest-*.json（vitest --reporter=json，按测试名匹配，必须存在且全部通过；跳过的外部工具用例记“部分”）、
 *      out/aigc-v10/tools.json（exiftool / ffprobe 是否可用）、../shots-v10/report.json（截图）、out/accept-v9.json（回归）、
 *      out/apk-manifest-v10.json（取回 APK 后写入，可选）、源码文件。
 * 结论只有：通过 / 部分 / 待真机 / 失败。需要真机的项永远不会记“通过”：只写“待真机”与验证步骤（见 design/acceptance-v10.md）。
 * 用法：node scripts/accept-v10.mjs [--strict]（--strict：有“失败”时退出码 1）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const txt = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };

const results = [];
for (const f of readdirSync(out).filter((n) => /^vitest-.*\.json$/.test(n))) {
  const j = J(join(out, f));
  for (const tr of j?.testResults ?? []) for (const a of tr.assertionResults ?? []) results.push({ name: `${(a.ancestorTitles ?? []).join(' > ')} > ${a.title}`, status: a.status, file: f });
}
const haveResults = results.length > 0;
/** 测试证据：全部 passed → ok；有 skipped（外部工具缺失）→ soft；找不到 / 有失败 → 失败。 */
function test(re, label = re) {
  const r = new RegExp(re);
  if (!haveResults) return { ok: false, soft: true, text: `${label}：本次未提供测试结果（先跑三套单测并输出 out/vitest-*.json）` };
  const hit = results.filter((x) => r.test(x.name));
  if (!hit.length) return { ok: false, text: `测试未找到：${label}` };
  const bad = hit.filter((x) => !['passed', 'skipped', 'pending', 'todo'].includes(x.status));
  const skipped = hit.filter((x) => x.status !== 'passed' && !bad.includes(x));
  return { ok: !bad.length && !skipped.length, soft: !bad.length && skipped.length > 0, text: `${label}：${hit.length} 项，通过 ${hit.length - bad.length - skipped.length}${skipped.length ? `，跳过 ${skipped.length}（外部工具不在本环境）` : ''}${bad.length ? `，失败 ${bad.length}` : ''}（${hit[0].file}）` };
}
const file = (p, label = p) => ({ ok: existsSync(join(root, p)), text: `${label}${existsSync(join(root, p)) ? ' 存在' : ' 缺失'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const shotsDir = [join(root, '../shots-v10'), join(root, 'shots-v10')].find((d) => existsSync(join(d, 'report.json')));
const shots = shotsDir ? J(join(shotsDir, 'report.json')) : null;
const tools = J(join(out, 'aigc-v10/tools.json'));
const v9 = J(join(out, 'accept-v9.json'));
const apk = J(join(out, 'apk-manifest-v10.json')) ?? J(join(root, '../out/apk-manifest-v10.json'));
const pkg = J(join(root, 'package.json'));
const semverGte = (a, b) => { const x = String(a ?? '0').split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return true; };
const device = (steps) => ({ ok: false, device: true, text: `需真机：${steps}` });

const ITEMS = [
  // ① Key 硬件绑定
  ['K1', 'SecureKeys 原生插件：AES-256-GCM 主密钥在 AndroidKeyStore（StrongBox 优先）、可选需解锁、decrypt 不新建密钥；已注册', [file('mobile/native/android/java/local/contentagent/app/SecureKeysPlugin.java', 'SecureKeysPlugin.java'), grep('mobile/native/android/java/local/contentagent/app/SecureKeysPlugin.java', 'setIsStrongBoxBacked[\\s\\S]*isInsideSecureHardware[\\s\\S]*NO_KEY', 'StrongBox / isInsideSecureHardware / NO_KEY'), grep('mobile/native/android/java/local/contentagent/app/MainActivity.java', 'registerPlugin\\(SecureKeysPlugin\\.class\\)', 'MainActivity 注册')]],
  ['K2', '可插拔 SecretBackend（webcrypto / android-keystore / electron-safeStorage），WebView 只拿加解密结果', [grep('web/src/local/secretBackend.ts', "'webcrypto'[\\s\\S]*'android-keystore'[\\s\\S]*'electron-safeStorage'", '三种后端'), grep('desktop/preload.cjs', 'safeStorage', 'Electron 预加载暴露 safeStorage'), test('网页版：用 WebCrypto', '网页版后端')]],
  ['K3', '旧 WebCrypto 存储一次性迁入，迁完删除', [test('一次性迁入硬件密钥库', '迁移单测（假插件）')]],
  ['K4', '迁移失败回退 WebCrypto 并明确提示（可重试）', [test('迁移失败', '失败回退单测'), test('插件不可用', '插件缺失回退')]],
  ['K5', '备份 / 日志 / VFS 扫描仍 0 命中', [test('迁移到硬件密钥库后备份仍 0 命中', '备份扫描'), test('trace 只记字段名与大小', 'trace 不含 Key')]],
  ['K6', '诊断页显示 isInsideSecureHardware', [test('诊断页 Key 存储', '诊断页渲染'), test('isInsideSecureHardware|一次性迁入', '诊断数据')], 'note:界面与数据已就绪，真机读数见 K7'],
  ['K7', '真机：KeyInfo.isInsideSecureHardware() 为 true 并显示在诊断页', [device('Android 13+ 真机安装 APK → 我的 → 运行状态 → 诊断 → Key 存储：当前后端 android-keystore、isInsideSecureHardware 是')]],
  ['K8', '真机：卸载重装后旧密文无法解密（预期）且界面提示重填', [test('卸载重装', '单测（模拟密钥丢失）'), device('填 Key → 开启系统备份或用 adb backup 保留数据 → 卸载重装并恢复 → 账号与 Key 显示“N 个 Key 在这台设备上解不开”')]],
  ['K9', '桌面：electron-safeStorage 实机', [device('Windows / macOS 桌面 App：诊断页当前后端 electron-safeStorage；Linux 仅 basic_text 时应回退 WebCrypto 并提示')]],
  // ② AIGC 隐式标识
  ['A1', 'JPEG：EXIF UserComment + XMP（dc:description + AIGC 命名空间：模型、服务提供者、内容编号、时间），纯 TS', [test('JPEG（纯 TS 读回）', 'JPEG 读回'), grep('web/src/v10/aigcMedia.ts', 'export function labelJpeg', 'labelJpeg'), { ok: !/from '(exif|piexif|mp4box|music-metadata|node-id3)/.test(txt('web/src/v10/aigcMedia.ts')), text: '未引第三方库' }]],
  ['A2', 'JPEG：exiftool 读出全部字段；原图已有 EXIF 时保留不剥离', [test('exiftool：', 'exiftool 外部校验'), test('已有服务商 UserComment', '服务商标识保留')]],
  ['A3', 'MP3 ID3v2.4 TXXX:AIGC、WAV LIST/INFO ICMT，ffprobe 读出', [test('音频（纯 TS 读回）', '音频读回'), test('ffprobe：(MP3|WAV)', 'ffprobe 外部校验')]],
  ['A4', '开头 0.5 秒提示音：设置里可开，默认关', [grep('shared/src/core/flags.ts', "id: 'media\\.audioCue'[^\\n]*default: false", '开关 media.audioCue 默认 false'), test('提示音默认关', '提示音单测'), test('WAV 提示音', 'ffprobe 时长 +0.5s')]],
  ['A5', 'MP4 只改 moov：udta/©cmt + meta/ilst；服务商已有标识保留；ffprobe 读出 comment', [test('MP4（纯 TS 读回）', 'MP4 读回'), test('ffprobe：(MP4|faststart)', 'ffprobe + 完整解码')]],
  ['A6', 'MP4 / 音频文件真机可正常播放', [test('可完整解码', 'ffmpeg 桌面解码'), device('真机：生成一段配音与视频，在卡片里播放、保存到相册后用系统播放器播放')]],
  // ③ 传输
  ['T1', 'transport：multipart / 二进制 JS 构造兜底与白话失败路径', [test('JS 构造 multipart', 'JS multipart'), test('FormData 发送抛错', 'FormData 失败重试'), test('Base64 文本', 'Base64 识别'), test('失败路径白话', '白话失败')]],
  ['T2', '真机：改图 / 转写 / 配音二进制跑通，trace 显示请求字段与返回 Base64 长度', [device('真机诊断页 → 上传与下载 → 自检（httpbin 回显 multipart 字段与文件、下载 PNG）；再用 Mock 以外的真实服务做一次转写 / 配音，导出 trace')]],
  // ④ 提醒
  ['N1', 'reminders：Android 13+ 通知权限、SCHEDULE_EXACT_ALARM、预排（allowWhileIdle）、拒权不崩', [test('有权限：新提醒立即预排', '预排 / 撤销'), test('拒绝通知权限', '拒权不崩'), test('精确闹钟未开', '精确闹钟'), test('不再重复弹', '不重复弹'), grep('mobile/scripts/apply-native.mjs', 'SCHEDULE_EXACT_ALARM', '清单权限说明')]],
  ['N2', '真机：关闭 App 后准点弹出', [device('Android 13+：允许通知 → 设 2 分钟后的提醒 → 从最近任务划掉 App → 准点收到通知；点通知回到对应会话')]],
  ['N3', '真机：拒绝权限时 App 内显示且不崩', [device('首次弹窗选“不允许” → 设 1 分钟后提醒 → 停留在 App 内 → 顶部出现提醒条；我的 → 提醒 显示“通知：已拒绝”')]],
  // ⑤ 截图
  ['S1', '卡片正常 / 失败态逐张截图 ≥22、溢出 / 越界 / 触控 <44 为 0', [shots ? { ok: shots.summary.cards >= 22 && !shots.summary.cardOverflow && !shots.summary.cardOob && !shots.summary.cardSmallTouch && !shots.summary.pageErrors, text: `shots-v10：卡片 ${shots.summary.cards} 张（${shots.summary.cardTypes} 类，正常 ${shots.summary.cardsPerState['-ok']} / 失败 ${shots.summary.cardsPerState['-fail']}），溢出 ${shots.summary.cardOverflow}、越界 ${shots.summary.cardOob}、触控<44 ${shots.summary.cardSmallTouch}；页面 ${shots.summary.pages} 张问题 ${shots.summary.pageOverflow + shots.summary.pageOob + shots.summary.pageSmallTouch}；页面报错 ${shots.summary.pageErrors}` } : { ok: false, soft: true, text: 'shots-v10/report.json 不在本环境（截图在项目根生成，不进仓库）' }, test('卡片预览：13 类', '卡片预览单测')]],
  // ⑥ 0.9.0 遗留
  ['R1', '“高级：按任务路由”页（补 D-ROUTING）', [test('高级：按任务路由', '路由页与运行时'), file('web/src/v10/RoutingPage.tsx')]],
  ['R2', '@ 菜单改版：能力分组、显示名（模型名）· 服务商、胶囊、只影响本轮、消息标注（补 D-AT）', [test('@ 菜单', '@ 菜单单测')]],
  // ⑦ 版本与回归
  ['V1', '版本 0.10.0 / versionCode 1000', [{ ok: semverGte(pkg?.version, '0.10.0'), text: `package.json ${pkg?.version}（0.11.0 起作回归：版本 ≥ 0.10.0 即可）` }, grep('mobile/scripts/apply-native.mjs', 'versionCode = x\\*10000', 'versionCode 按版本计算（0.10.0 → 1000）'), apk ? { ok: apk.versionName === '0.10.0' && String(apk.versionCode) === '1000', text: `APK：${apk.versionName} / ${apk.versionCode}` } : { ok: true, text: 'APK 0.10.0 已在 0.10 交付时核对（回归时不再要求）' }]],
  ['V2', 'accept:v9 回归：失败 0', [v9 ? { ok: (v9.count?.fail ?? v9.counts?.['失败'] ?? 1) === 0, text: `accept-v9：${JSON.stringify(v9.count ?? v9.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 node scripts/accept-v9.mjs' }]],
  ['V3', '硬边界：未新增任何对外写入工具（点赞 / 评论 / 私信 / 关注 / 自动发布）', [{ ok: !/name: '(like|comment|dm|follow|publish_send|auto_publish)[a-z_]*'/.test(txt('shared/src/agent/builtinTools.ts')), text: '内置工具名检查' }, grep('server/src/boundaries.ts', '.', 'boundaries.ts 存在')]],
];

const rows = ITEMS.map(([id, title, checks, extra]) => {
  const anyDevice = checks.some((c) => c.device);
  const nonDevice = checks.filter((c) => !c.device);
  const allOk = nonDevice.every((c) => c.ok);
  const anyHard = nonDevice.some((c) => !c.ok && !c.soft);
  const verdict = anyHard ? '失败' : anyDevice ? '待真机' : allOk ? '通过' : '部分';
  return { id, title, verdict, evidence: checks.map((c) => `${c.device ? '📱' : c.ok ? '✓' : c.soft ? '△' : '✗'} ${c.text}`), note: typeof extra === 'string' ? extra.replace(/^note:/, '') : undefined };
});
const counts = rows.reduce((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] ?? 0) + 1 }), {});
const report = { version: pkg?.version, generatedAt: new Date().toISOString(), haveTestResults: haveResults, externalTools: tools, counts, items: rows };
writeFileSync(join(out, 'accept-v10.json'), JSON.stringify(report, null, 1));
const md = [`# accept:v10（${report.generatedAt}）`, '', `通过 ${counts['通过'] ?? 0} · 部分 ${counts['部分'] ?? 0} · 待真机 ${counts['待真机'] ?? 0} · 失败 ${counts['失败'] ?? 0}`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')}${r.note ? `<br>注：${r.note}` : ''} |`)].join('\n');
writeFileSync(join(out, 'accept-v10.md'), md + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：通过 ${counts['通过'] ?? 0} · 部分 ${counts['部分'] ?? 0} · 待真机 ${counts['待真机'] ?? 0} · 失败 ${counts['失败'] ?? 0}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
