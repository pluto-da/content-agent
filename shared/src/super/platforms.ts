/**
 * 1.2.0 自定义平台（PROMPT-v1.2 第六部分）：platforms/<id>/PLATFORM.md 清单、14 个模板（规格附来源与核对日期，未核实字段标“待核实”）、
 * 三种创建方式（模板复制 / 一句话起草 / 导入 .platform.zip）、内置 + 用户两源合并。
 * 单一真相源：PLATFORM.md 只放规格与清单；写法只在平台技能 skills/<id>/SKILL.md（新平台技能属 L3，进审批收件箱）。
 * 能力边界：自定义平台与内置平台完全相同，且只有 打开官方页 / App、复制、发布前检查、分屏、写法适配、数据导入。没有发布、没有互动。
 */
import { parseDoc, serializeDoc } from '../vfs/frontmatter.js';
import { zip, unzip } from '../vfs/archive.js';
import { utf8 } from '../core/hash.js';
import { findSecrets } from '../core/redact.js';
import { RELAX_PATTERNS } from '../agent/policy.js';

export const PLATFORM_CAPABILITIES = ['open_web', 'open_app', 'copy', 'checklist', 'split_screen', 'adapt', 'data_import'] as const;
export type PlatformCapability = typeof PLATFORM_CAPABILITIES[number];
export const PLATFORM_NOTICE = '发布与互动都由你本人在官方 App 内完成。';
export type ContentForm = 'image_text' | 'short_video' | 'long_article' | 'audio' | 'qa' | 'product';
export const FORM_TEXT: Record<ContentForm, string> = { image_text: '图文', short_video: '短视频', long_article: '长文', audio: '音频', qa: '问答', product: '商品' };
/** 一个规格字段：值 + 来源 + 核对日期；核对不到就 value=null、verified=false（界面显示“待核实”）。 */
export interface SpecField { value: number | string | null; source?: string; checkedAt?: string; verified: boolean; note?: string }
export const UNVERIFIED = '待核实';
export interface PlatformSpec { titleMax: SpecField; bodyMax: SpecField; images: SpecField; imageRatio: SpecField; videoMaxSec: SpecField; videoRatio: SpecField; hashtagRule: SpecField; cover: SpecField }
export const SPEC_KEYS: (keyof PlatformSpec)[] = ['titleMax', 'bodyMax', 'images', 'imageRatio', 'videoMaxSec', 'videoRatio', 'hashtagRule', 'cover'];
export const SPEC_TEXT: Record<keyof PlatformSpec, string> = { titleMax: '标题字数', bodyMax: '正文字数', images: '图片数量', imageRatio: '图片比例', videoMaxSec: '视频时长（秒）', videoRatio: '视频比例', hashtagRule: '话题标签规则', cover: '封面要求' };
export interface PlatformManifest {
  id: string; name: string; icon: string; url: string; publishUrl: string; android?: string; ios?: string; hosts: string[];
  forms: ContentForm[]; spec: PlatformSpec; checklist: string[]; metrics: Record<string, string>; hotSources: string[];
  capabilities: PlatformCapability[]; source: 'builtin' | 'user'; readonly: boolean; createdBy: 'user' | 'super'; template?: string; version: number;
}
export const PLATFORM_ID = /^[a-z][a-z0-9_-]{0,39}$/;
export const platformPath = (id: string): string => `platforms/${id}/PLATFORM.md`;

const U = (note?: string): SpecField => ({ value: null, verified: false, ...(note ? { note } : {}) });
const V = (value: number | string, source: string, checkedAt = '2026-10-24', note?: string): SpecField => ({ value, source, checkedAt, verified: true, ...(note ? { note } : {}) });
/** 沿用 1.1 代码里的规则值（shared/src/platforms.ts），本轮没有重新打开官方页核对 → 仍标待核实，值作为建议。 */
const L = (value: number | string): SpecField => ({ value: null, verified: false, note: `沿用 1.1 规则建议值 ${value}；官方页本轮未核对` });
const spec = (p: Partial<PlatformSpec>): PlatformSpec => ({ titleMax: U(), bodyMax: U(), images: U(), imageRatio: U(), videoMaxSec: U(), videoRatio: U(), hashtagRule: U(), cover: U(), ...p });
const CHECK = ['标题与正文没有极限词、夸大承诺', '图片 / 视频含 AI 生成内容时已勾选平台的 AI 声明', '没有搬运他人内容', '发布由我本人在官方 App 内点击'];

interface Tpl { id: string; name: string; url: string; publishUrl: string; android?: string; ios?: string; hosts: string[]; forms: ContentForm[]; spec: PlatformSpec; metrics?: Record<string, string>; hotSources?: string[] }
const TPL: Tpl[] = [
  { id: 'douyin', name: '抖音', url: 'https://creator.douyin.com/', publishUrl: 'https://creator.douyin.com/creator-micro/content/upload', android: 'com.ss.android.ugc.aweme', ios: 'snssdk1128://', hosts: ['douyin.com', 'creator.douyin.com'], forms: ['short_video', 'image_text'], spec: spec({}) },
  { id: 'xiaohongshu', name: '小红书', url: 'https://creator.xiaohongshu.com/', publishUrl: 'https://creator.xiaohongshu.com/publish/publish', android: 'com.xingin.xhs', ios: 'xhsdiscover://', hosts: ['xiaohongshu.com', 'creator.xiaohongshu.com'], forms: ['image_text', 'short_video'], spec: spec({ titleMax: L(20), bodyMax: L(1000), hashtagRule: L('≤10 个') }) },
  { id: 'channels', name: '视频号', url: 'https://channels.weixin.qq.com/', publishUrl: 'https://channels.weixin.qq.com/platform/post/create', android: 'com.tencent.mm', ios: 'weixin://', hosts: ['channels.weixin.qq.com'], forms: ['short_video'], spec: spec({}) },
  { id: 'wechat_mp', name: '公众号', url: 'https://mp.weixin.qq.com/', publishUrl: 'https://mp.weixin.qq.com/', android: 'com.tencent.mm', ios: 'weixin://', hosts: ['mp.weixin.qq.com'], forms: ['long_article'], spec: spec({ titleMax: L(64) }) },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/creator', publishUrl: 'https://zhuanlan.zhihu.com/write', android: 'com.zhihu.android', ios: 'zhihu://', hosts: ['zhihu.com', 'zhuanlan.zhihu.com'], forms: ['qa', 'long_article'], spec: spec({}) },
  { id: 'xianyu', name: '闲鱼', url: 'https://www.goofish.com/', publishUrl: 'https://www.goofish.com/', android: 'com.taobao.idlefish', ios: 'fleamarket://', hosts: ['goofish.com'], forms: ['product'], spec: spec({ titleMax: L(30) }) },
  { id: 'x', name: 'X', url: 'https://x.com/home', publishUrl: 'https://x.com/compose/post', android: 'com.twitter.android', ios: 'twitter://', hosts: ['x.com', 'twitter.com'], forms: ['image_text'], spec: spec({ bodyMax: L('280（加权，中文按 2 计）') }) },
  { id: 'bilibili', name: 'B站', url: 'https://member.bilibili.com/platform/home', publishUrl: 'https://member.bilibili.com/platform/upload/video/frame', android: 'tv.danmaku.bili', ios: 'bilibili://', hosts: ['bilibili.com', 'member.bilibili.com'], forms: ['short_video', 'long_article'], spec: spec({}), hotSources: [] },
  { id: 'kuaishou', name: '快手', url: 'https://cp.kuaishou.com/', publishUrl: 'https://cp.kuaishou.com/article/publish/video', android: 'com.smile.gifmaker', ios: 'kwai://', hosts: ['kuaishou.com', 'cp.kuaishou.com'], forms: ['short_video'], spec: spec({}) },
  { id: 'weibo', name: '微博', url: 'https://weibo.com/', publishUrl: 'https://weibo.com/', android: 'com.sina.weibo', ios: 'sinaweibo://', hosts: ['weibo.com', 'm.weibo.cn'], forms: ['image_text', 'short_video'], spec: spec({}) },
  { id: 'douban', name: '豆瓣', url: 'https://www.douban.com/', publishUrl: 'https://www.douban.com/', android: 'com.douban.frodo', ios: 'douban://', hosts: ['douban.com'], forms: ['long_article', 'image_text'], spec: spec({}) },
  { id: 'xiaoyuzhou', name: '小宇宙', url: 'https://podcaster.xiaoyuzhoufm.com/', publishUrl: 'https://podcaster.xiaoyuzhoufm.com/', ios: 'cosmos://', hosts: ['xiaoyuzhoufm.com', 'podcaster.xiaoyuzhoufm.com'], forms: ['audio'], spec: spec({}) },
  { id: 'youtube', name: 'YouTube', url: 'https://studio.youtube.com/', publishUrl: 'https://studio.youtube.com/', android: 'com.google.android.youtube', ios: 'youtube://', hosts: ['youtube.com', 'studio.youtube.com'], forms: ['short_video', 'long_article'], spec: spec({ titleMax: V(100, 'https://support.google.com/youtube/answer/57404'), bodyMax: V(5000, 'https://support.google.com/youtube/answer/57404', '2026-10-24', '视频说明') }) },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/', publishUrl: 'https://www.instagram.com/', android: 'com.instagram.android', ios: 'instagram://', hosts: ['instagram.com'], forms: ['image_text', 'short_video'], spec: spec({ bodyMax: V(2200, 'https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media', '2026-10-24', 'Meta 开发者文档写的说明上限；帮助中心未写'), hashtagRule: V('每篇 ≤5 个', 'https://help.instagram.com/351460621611097/', '2026-10-24', '帮助中心原文 “You can use up to 5 tags on a post”') }) },
];
const DEFAULT_METRICS = { 阅读: 'views', 点赞: 'likes', 收藏: 'collects', 评论: 'comments', 分享: 'shares', 涨粉: 'followers' };
export const PLATFORM_TEMPLATES: PlatformManifest[] = TPL.map((t) => ({ ...t, icon: t.name.slice(0, 1), checklist: [...CHECK], metrics: t.metrics ?? { ...DEFAULT_METRICS }, hotSources: t.hotSources ?? [], capabilities: [...PLATFORM_CAPABILITIES], source: 'builtin', readonly: true, createdBy: 'user', template: t.id, version: 1 }));

/* ---------------- PLATFORM.md ---------------- */
export function serializePlatformMd(p: PlatformManifest): string {
  const fm: Record<string, unknown> = { id: p.id, name: p.name, icon: p.icon, url: p.url, publishUrl: p.publishUrl, ...(p.android ? { android: p.android } : {}), ...(p.ios ? { ios: p.ios } : {}), hosts: p.hosts, forms: p.forms, capabilities: p.capabilities, source: p.source, readonly: p.readonly, createdBy: p.createdBy, ...(p.template ? { template: p.template } : {}), version: p.version };
  const rows = SPEC_KEYS.map((k) => { const f = p.spec[k]; return `| ${k} | ${SPEC_TEXT[k]} | ${f.verified && f.value !== null ? String(f.value) : UNVERIFIED} | ${f.source ?? ''} | ${f.checkedAt ?? ''} | ${(f.note ?? '').replace(/\|/g, '/')} |`; });
  const body = [
    `# ${p.name}`, '', `> ${PLATFORM_NOTICE} 写法见技能 skills/${p.id}/SKILL.md（本文件只放规格与清单）。`, '',
    '## 规格', '| 字段 | 名称 | 值 | 来源 | 核对日期 | 说明 |', '|---|---|---|---|---|---|', ...rows, '',
    '## 发布前检查', ...p.checklist.map((c) => `- [ ] ${c}`), '',
    '## 数据指标口径', ...Object.entries(p.metrics).map(([k, v]) => `- ${k} → ${v}`), '',
    '## 热点来源', ...(p.hotSources.length ? p.hotSources.map((u) => `- ${u}`) : ['- （无；只接 RSS 或官方公开榜单，须守 robots）']), '',
  ].join('\n');
  return serializeDoc(fm, body);
}
export function parsePlatformMd(text: string): PlatformManifest {
  const { fm, body } = parseDoc(text);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const s = spec({});
  for (const line of body.split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    const k = c[1] as keyof PlatformSpec;
    if (c.length >= 7 && SPEC_KEYS.includes(k)) {
      const raw = c[3]!;
      const verified = raw !== UNVERIFIED && raw !== '' && !!c[4];
      s[k] = { value: verified ? (/^\d+$/.test(raw) ? Number(raw) : raw) : null, verified, ...(c[4] ? { source: c[4] } : {}), ...(c[5] ? { checkedAt: c[5] } : {}), ...(c[6] ? { note: c[6] } : {}) };
    }
  }
  const sec = (title: string) => (body.split(`## ${title}`)[1] ?? '').split('\n## ')[0]!.split('\n').filter((l) => l.startsWith('- '));
  const checklist = sec('发布前检查').map((l) => l.replace(/^- \[[ x]\]\s*/, '').trim()).filter(Boolean);
  const metrics = Object.fromEntries(sec('数据指标口径').map((l) => l.slice(2).split('→').map((x) => x.trim()) as [string, string]).filter((x) => x[0] && x[1]));
  const hotSources = sec('热点来源').map((l) => l.slice(2).trim()).filter((u) => /^https?:\/\//.test(u));
  const caps = arr(fm.capabilities).filter((c): c is PlatformCapability => (PLATFORM_CAPABILITIES as readonly string[]).includes(c));
  return {
    id: String(fm.id ?? ''), name: String(fm.name ?? ''), icon: String(fm.icon ?? ''), url: String(fm.url ?? ''), publishUrl: String(fm.publishUrl ?? fm.url ?? ''),
    android: fm.android ? String(fm.android) : undefined, ios: fm.ios ? String(fm.ios) : undefined, hosts: arr(fm.hosts), forms: arr(fm.forms) as ContentForm[], spec: s, checklist, metrics, hotSources,
    capabilities: caps.length ? caps : [...PLATFORM_CAPABILITIES], source: fm.source === 'builtin' ? 'builtin' : 'user', readonly: fm.readonly === true, createdBy: fm.createdBy === 'super' ? 'super' : 'user', template: fm.template ? String(fm.template) : undefined, version: Number(fm.version ?? 1) || 1,
  };
}
const FORBIDDEN_CAP = /(publish|post|comment|like|follow|dm|message|auto|click|发布|评论|点赞|关注|私信)/i;
export function validatePlatform(p: PlatformManifest, o: { existing?: string[] } = {}): string[] {
  const e: string[] = [];
  if (!PLATFORM_ID.test(p.id)) e.push(`id 需小写字母开头（小写字母、数字、- 或 _）：${p.id}`);
  if (!p.name.trim()) e.push('缺少平台名称');
  if (!/^https:\/\//.test(p.url)) e.push('官方网址需为 https');
  if (p.publishUrl && !/^https:\/\//.test(p.publishUrl)) e.push('发布页网址需为 https');
  for (const h of p.hosts) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) e.push(`内置浏览器允许的域名不合法：${h}`);
  if (p.url && p.hosts.length && !p.hosts.some((h) => new URL(p.url).hostname.endsWith(h))) e.push('官方网址的域名不在允许列表里');
  const caps = p.capabilities as string[];
  for (const c of caps) if (!(PLATFORM_CAPABILITIES as readonly string[]).includes(c) || FORBIDDEN_CAP.test(c)) e.push(`硬边界：平台能力只有打开 / 复制 / 发布前检查 / 分屏 / 写法适配 / 数据导入，不能有 ${c}`);
  for (const u of p.hotSources) if (!/^https:\/\//.test(u)) e.push(`热点来源需为 https 的 RSS 或官方公开榜单：${u}`);
  for (const k of SPEC_KEYS) { const f = p.spec[k]; if (f.verified && (!f.source || !f.checkedAt)) e.push(`${SPEC_TEXT[k]} 标为已核实但缺来源或核对日期`); }
  if (RELAX_PATTERNS.test(serializePlatformMd(p))) e.push('清单试图放宽硬边界');
  if (findSecrets(serializePlatformMd(p)).length) e.push('发现疑似密钥');
  if (o.existing?.includes(p.id)) e.push(`已有同 id 的平台：${p.id}`);
  return e;
}

/* ---------------- 三种创建方式 ---------------- */
/** 1）从模板复制：得到用户可编辑的副本（readonly=false，source=user，id 可改）。 */
export function platformFromTemplate(templateId: string, patch: Partial<PlatformManifest> = {}): PlatformManifest {
  const t = PLATFORM_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`没有这个平台模板：${templateId}`);
  return { ...structuredClone(t), source: 'user', readonly: false, template: templateId, ...patch, capabilities: [...PLATFORM_CAPABILITIES] };
}
/** 2）一句话起草：抽出名称与网址，规格全部“待核实”；写法技能单独起草、进审批（L3）。 */
export function draftPlatformFromSentence(sentence: string, existing: string[] = []): { manifest: PlatformManifest; skill: { path: string; content: string } } {
  const s = sentence.trim();
  const url = /(https:\/\/[^\s，。,]+)/.exec(s)?.[1] ?? '';
  const name = (/(?:叫|名为|平台[:：]?)\s*[“"「]?([^”"」，,。\s的]{1,16})/.exec(s)?.[1] ?? /^(?:加|添加|新建)(?:一个)?([^，,。\s]{1,16}?)(?:平台|社区|网站)/.exec(s)?.[1] ?? '新平台').trim();
  const forms: ContentForm[] = [/视频/.test(s) && 'short_video', /长文|文章|博客/.test(s) && 'long_article', /播客|音频/.test(s) && 'audio', /问答/.test(s) && 'qa', /商品|闲置/.test(s) && 'product', /图文|笔记/.test(s) && 'image_text'].filter(Boolean) as ContentForm[];
  let host = ''; try { host = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { /* */ }
  let id = (host.split('.').slice(-2, -1)[0] ?? '').replace(/[^a-z0-9_-]/g, '') || 'custom';
  if (!/^[a-z]/.test(id)) id = `p-${id}`;
  let n = 1; const base = id; while (existing.includes(id) || id.length < 2) id = `${base}-${++n}`;
  const manifest: PlatformManifest = { id, name, icon: name.slice(0, 1), url, publishUrl: url, hosts: host ? [host] : [], forms: forms.length ? forms : ['image_text'], spec: spec({}), checklist: [...CHECK], metrics: { ...DEFAULT_METRICS }, hotSources: [], capabilities: [...PLATFORM_CAPABILITIES], source: 'user', readonly: false, createdBy: 'super', version: 1 };
  const skill = { path: `skills/${id}/SKILL.md`, content: `---\nname: ${id}\ndescription: ${name} 的写法（超级 Agent 起草，等你确认）\nplatform: ${id}\nsource: user\nversion: 1\n---\n# ${name} 写法\n> 本技能由超级 Agent 根据你的一句话起草：“${s.replace(/\n/g, ' ').slice(0, 120)}”。规格以 platforms/${id}/PLATFORM.md 为准，未核实的字段先按通用写法。\n\n## 结构\n1. 开头一句话说清这篇给谁、解决什么。\n2. 正文分 3 段，每段一个要点，用你自己的经历或数据。\n3. 结尾给一个具体的下一步。\n\n## 不做\n- 不夸大、不用极限词、不搬运；发布由你本人在官方 App 内完成。\n` };
  return { manifest, skill };
}
/** 3）导入 .platform.zip：PLATFORM.md（+ 可选写法技能）；导入前 Key 扫描、硬边界、能力上限（多出来的能力去掉）。 */
export function exportPlatformZip(p: PlatformManifest, skill?: string): Uint8Array {
  const files = [{ path: 'PLATFORM.md', content: serializePlatformMd(p) }, ...(skill ? [{ path: 'SKILL.md', content: skill }] : [])];
  for (const f of files) if (findSecrets(f.content).length) throw new Error(`导出已阻止：${f.path} 有疑似密钥`);
  return zip([{ path: 'manifest.json', data: utf8(JSON.stringify({ kind: 'platform', schemaVersion: 1, id: p.id })) }, ...files.map((f) => ({ path: f.path, data: utf8(f.content) }))]);
}
export function importPlatformZip(data: Uint8Array, o: { existing?: string[] } = {}): { ok: boolean; manifest?: PlatformManifest; skill?: string; errors: string[] } {
  let entries; try { entries = unzip(data); } catch (e) { return { ok: false, errors: [`不是有效的 zip：${(e as Error).message}`] }; }
  const dec = new TextDecoder(); const files = new Map(entries.map((x) => [x.path, dec.decode(x.data)]));
  const errors: string[] = [];
  for (const [p, c] of files) if (findSecrets(c).length) errors.push(`${p} 有疑似密钥，整个包拒绝导入`);
  const md = files.get('PLATFORM.md');
  if (!md) return { ok: false, errors: [...errors, '缺少 PLATFORM.md'] };
  const raw = parseDoc(md).fm.capabilities;
  const m = { ...parsePlatformMd(md), source: 'user' as const, readonly: false };
  if (Array.isArray(raw) && raw.some((c) => !(PLATFORM_CAPABILITIES as readonly string[]).includes(String(c)))) errors.push(`硬边界：包里声明了不允许的能力 ${raw.filter((c) => !(PLATFORM_CAPABILITIES as readonly string[]).includes(String(c))).join('、')}`);
  errors.push(...validatePlatform(m, o));
  return { ok: errors.length === 0, manifest: m, skill: files.get('SKILL.md'), errors };
}

/* ---------------- 两源合并 ---------------- */
export interface MergedPlatform { id: string; label: string; url: string; publishUrl: string; hosts: string[]; android?: string; ios?: string; capabilities: PlatformCapability[]; source: 'builtin' | 'user' }
/** PLATFORMS = 内置 + 用户；id 冲突时内置优先，用户那条记入 conflicts（界面提示改名）。 */
export function mergePlatforms(builtin: { id: string; label: string; url: string; publishUrl: string; hosts: string[]; android?: string; ios?: string }[], user: PlatformManifest[]): { list: MergedPlatform[]; conflicts: string[] } {
  const list: MergedPlatform[] = builtin.map((b) => ({ ...b, capabilities: [...PLATFORM_CAPABILITIES], source: 'builtin' }));
  const conflicts: string[] = [];
  for (const u of user) {
    if (u.source === 'builtin' || u.readonly) continue;
    if (list.some((x) => x.id === u.id)) { conflicts.push(u.id); continue; }
    list.push({ id: u.id, label: u.name, url: u.url, publishUrl: u.publishUrl || u.url, hosts: u.hosts, android: u.android, ios: u.ios, capabilities: [...PLATFORM_CAPABILITIES], source: 'user' });
  }
  return { list, conflicts };
}
/** 发布前检查清单 → 每项都是“由你勾选”，没有任何自动动作。 */
export function checklistFor(p: PlatformManifest): { text: string; byUser: true }[] { return p.checklist.map((text) => ({ text, byUser: true })); }
