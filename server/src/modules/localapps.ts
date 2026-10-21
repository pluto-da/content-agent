import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { CREATOR_CENTERS, isCenterId, type CenterId } from './handoff.js';

/**
 * 本地应用：用户为每个平台登记本机/手机上的官方 App，用于“打开应用”和“分享草稿到应用”。
 * 只保存启动信息（包名、URL Scheme、可执行文件路径、协议），不保存任何账号或登录数据。
 * 启动与分享都发生在客户端（系统分享面板 / Intent / shell.openPath），由用户本人在 App 内完成发布。
 */
export const APP_OS = ['android', 'ios', 'windows', 'mac'] as const;
export type AppOs = (typeof APP_OS)[number];
export const isAppOs = (s: string): s is AppOs => (APP_OS as readonly string[]).includes(s);

export interface LocalApp {
  id: number;
  platform: CenterId;
  os: AppOs;
  label: string;
  package_name: string | null;
  deep_link: string | null;
  url_scheme: string | null;
  exec_path: string | null;
  protocol: string | null;
  created_at: string;
  updated_at: string;
}

export type LocalAppInput = Partial<Pick<LocalApp, 'label' | 'package_name' | 'deep_link' | 'url_scheme' | 'exec_path' | 'protocol'>> & { platform: string; os: string };

/** 各平台官方 App 的预设（包名 / Scheme），用于一键填写；用户可以改。 */
export const KNOWN_APPS = CREATOR_CENTERS.map((c) => ({ platform: c.id, label: c.label.replace(/创作者中心|创作服务平台|助手|创作中心|公众平台/g, '').trim() || c.label, android: c.android, ios: c.ios }));

const PKG_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]{1,40}:\/\/[^\s<>"']{0,500}$/i;
const BAD_SCHEMES = /^(javascript|data|vbscript|file|about|blob|content|intent|chrome|ms-settings|shell)\b/i;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/;

/** 自定义 URL Scheme（如 zhihu://）；拒绝 javascript:/file: 等危险协议与 http(s)。 */
export function validScheme(s: string): boolean {
  return SCHEME_RE.test(s) && !BAD_SCHEMES.test(s) && !/^https?:/i.test(s);
}

/** 深链接：自定义 Scheme 或 https 通用链接。 */
export function validDeepLink(s: string): boolean {
  if (/^https:\/\//i.test(s)) {
    try { return new URL(s).protocol === 'https:' && !CTRL.test(s); } catch { return false; }
  }
  return validScheme(s);
}

/** 桌面可执行文件：Windows 绝对路径 .exe/.lnk，或 macOS 的 .app 包路径。只登记路径，启动由桌面端用户触发。 */
export function validExecPath(p: string, os: AppOs): boolean {
  if (!p || p.length > 1024 || CTRL.test(p) || p.includes('..')) return false;
  if (os === 'windows') return /^(?:[a-zA-Z]:\\|\\\\)[^<>"|?*]+\.(exe|lnk)$/i.test(p);
  if (os === 'mac') return /^\/[^\0]+\.app\/?$/.test(p);
  return false;
}

export function normalizeInput(b: LocalAppInput): Omit<LocalApp, 'id' | 'created_at' | 'updated_at'> {
  const platform = String(b.platform ?? '');
  const os = String(b.os ?? '');
  if (!isCenterId(platform)) throw new Error('未知的平台');
  if (!isAppOs(os)) throw new Error('系统只能是 android / ios / windows / mac');
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const out = {
    platform, os,
    label: (t(b.label) ?? KNOWN_APPS.find((k) => k.platform === platform)?.label ?? platform).slice(0, 60),
    package_name: os === 'android' ? t(b.package_name) : null,
    deep_link: os === 'android' ? t(b.deep_link) : null,
    url_scheme: os === 'ios' ? t(b.url_scheme) : null,
    exec_path: os === 'windows' || os === 'mac' ? t(b.exec_path) : null,
    protocol: os === 'windows' || os === 'mac' ? t(b.protocol) : null,
  };
  if (os === 'android') {
    if (!out.package_name || !PKG_RE.test(out.package_name) || out.package_name.length > 200) throw new Error('Android 包名格式不正确，例如 com.zhihu.android');
    if (out.deep_link && !validDeepLink(out.deep_link)) throw new Error('深链接格式不正确（自定义 Scheme 或 https 链接）');
  }
  if (os === 'ios' && (!out.url_scheme || !validScheme(out.url_scheme))) throw new Error('iOS 需要 URL Scheme，例如 zhihu://');
  if (os === 'windows' || os === 'mac') {
    if (!out.exec_path && !out.protocol) throw new Error('电脑端需要可执行文件/.app 路径或协议（如 zhihu://）');
    if (out.exec_path && !validExecPath(out.exec_path, os)) throw new Error(os === 'windows' ? '路径需为绝对路径的 .exe 或 .lnk' : '路径需为 .app 应用包的绝对路径');
    if (out.protocol && !validScheme(out.protocol)) throw new Error('协议格式不正确，例如 zhihu://');
  }
  return out;
}

export function listLocalApps(db: DB): LocalApp[] {
  return db.prepare('SELECT * FROM local_apps ORDER BY platform, os').all() as unknown as LocalApp[];
}

/** 同一平台、同一系统只保留一条（再次保存即更新）。 */
export function upsertLocalApp(db: DB, b: LocalAppInput): LocalApp {
  const v = normalizeInput(b);
  db.prepare(`INSERT INTO local_apps(platform, os, label, package_name, deep_link, url_scheme, exec_path, protocol) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(platform, os) DO UPDATE SET label = excluded.label, package_name = excluded.package_name, deep_link = excluded.deep_link,
    url_scheme = excluded.url_scheme, exec_path = excluded.exec_path, protocol = excluded.protocol, updated_at = datetime('now')`)
    .run(v.platform, v.os, v.label, v.package_name, v.deep_link, v.url_scheme, v.exec_path, v.protocol);
  return db.prepare('SELECT * FROM local_apps WHERE platform = ? AND os = ?').get(v.platform, v.os) as unknown as LocalApp;
}

export function deleteLocalApp(db: DB, id: number): boolean {
  return Number(db.prepare('DELETE FROM local_apps WHERE id = ?').run(id).changes) > 0;
}

export interface LocalAppsExport { format: 'content-agent-local-apps'; version: 1; exportedAt: string; apps: Omit<LocalApp, 'id' | 'created_at' | 'updated_at'>[] }

export function exportLocalApps(db: DB): LocalAppsExport {
  return {
    format: 'content-agent-local-apps', version: 1, exportedAt: new Date().toISOString(),
    apps: listLocalApps(db).map(({ id: _i, created_at: _c, updated_at: _u, ...rest }) => rest),
  };
}

/** 导入：逐条校验，合法的覆盖同平台同系统的条目；不合法的列出原因，不中断其他条目。 */
export function importLocalApps(db: DB, data: unknown): { imported: number; errors: { index: number; error: string }[] } {
  const d = data as Partial<LocalAppsExport>;
  if (!d || d.format !== 'content-agent-local-apps' || !Array.isArray(d.apps)) throw new Error('不是有效的本地应用导出文件');
  const errors: { index: number; error: string }[] = [];
  let imported = 0;
  d.apps.slice(0, 500).forEach((a, index) => {
    try { upsertLocalApp(db, a as LocalAppInput); imported++; } catch (e) { errors.push({ index, error: (e as Error).message }); }
  });
  return { imported, errors };
}

type ErrFactory = (code: string, message: string, status?: number) => Error;

/** 注册 /api/local-apps 路由。 */
export function registerLocalApps(app: FastifyInstance, db: DB, err: ErrFactory): void {
  app.get('/api/local-apps', async () => ({ apps: listLocalApps(db), known: KNOWN_APPS, os: APP_OS }));
  app.put('/api/local-apps', async (req) => {
    try { return { app: upsertLocalApp(db, (req.body ?? {}) as LocalAppInput) }; } catch (e) { throw err('bad_local_app', (e as Error).message); }
  });
  app.delete('/api/local-apps/:id', async (req) => {
    if (!deleteLocalApp(db, Number((req.params as { id: string }).id))) throw err('not_found', '条目不存在', 404);
    return { ok: true };
  });
  app.get('/api/local-apps/export', async (_req, reply) => {
    reply.header('content-disposition', 'attachment; filename="content-agent-local-apps.json"');
    return exportLocalApps(db);
  });
  app.post('/api/local-apps/import', async (req) => {
    try { return importLocalApps(db, req.body); } catch (e) { throw err('import_failed', (e as Error).message); }
  });
}
