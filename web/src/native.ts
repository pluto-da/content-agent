/**
 * 本地应用：打开用户登记的官方 App、把草稿分享到 App。
 * 只做“启动应用 / 系统分享 / 复制”，不操控 App 内任何界面；最后的发布由用户本人点击。
 */
import { registerPlugin } from '@capacitor/core';
import { mediaUrl } from './api';
import { appOs, copyText, electronBridge, runtime, type AppOs } from './runtime';

export interface LocalAppEntry {
  id?: number;
  platform: string;
  os: AppOs;
  label: string;
  package_name?: string | null;
  deep_link?: string | null;
  url_scheme?: string | null;
  exec_path?: string | null;
  protocol?: string | null;
}

export interface KnownApp { platform: string; label: string; android: string; ios: string }

interface LocalAppsPlugin {
  listLaunchable(): Promise<{ apps: { packageName: string; label: string }[] }>;
  isInstalled(o: { packageName: string }): Promise<{ installed: boolean }>;
  launch(o: { packageName?: string; deepLink?: string; url?: string }): Promise<void>;
  canOpen(o: { url: string }): Promise<{ canOpen: boolean }>;
  share(o: { packageName?: string; text: string; files: { url: string; name: string; mime: string }[]; headers: Record<string, string> }): Promise<unknown>;
}

export const LocalApps = registerPlugin<LocalAppsPlugin>('LocalApps');

export interface ShareAsset { type: string; url: string }
export interface ActionResult { ok: boolean; message: string }

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp3: 'audio/mpeg', mp4: 'video/mp4', srt: 'text/plain' };

/** 当前终端能否“导入已安装应用”（只有 Android App 能列出 <queries> 中声明且已安装的包）。 */
export function canListInstalled(): boolean {
  return runtime() === 'capacitor' && appOs() === 'android';
}

/** 列出可导入的已安装应用。受 Android 包可见性限制，只包含清单中声明的官方 App。 */
export async function listInstalledApps(): Promise<{ packageName: string; label: string }[]> {
  if (!canListInstalled()) return [];
  return (await LocalApps.listLaunchable()).apps;
}

/** 桌面端：用系统对话框选择 .exe / .app。 */
export async function pickDesktopApp(): Promise<string | null> {
  return (await electronBridge()?.localApp?.pick()) ?? null;
}

/** 根据登记信息生成网页端可用的跳转地址（URL Scheme / 深链接 / Android Chrome intent）。 */
export function webLaunchUrl(e: LocalAppEntry): string | null {
  if (e.os === 'android') {
    if (e.deep_link) return e.deep_link;
    if (e.package_name) return `intent://#Intent;package=${e.package_name};end`;
    return null;
  }
  if (e.os === 'ios') return e.url_scheme ?? null;
  return e.protocol ?? null;
}

export async function launchLocalApp(e: LocalAppEntry): Promise<ActionResult> {
  const rt = runtime();
  try {
    if (rt === 'capacitor') {
      if (e.os === 'android') await LocalApps.launch({ packageName: e.package_name ?? '', deepLink: e.deep_link ?? undefined });
      else await LocalApps.launch({ url: e.url_scheme ?? '' });
      return { ok: true, message: '已打开应用' };
    }
    if (rt === 'electron') {
      const r = await electronBridge()!.localApp!.launch({ execPath: e.exec_path, protocol: e.protocol });
      return { ok: r.ok, message: r.ok ? '已打开应用' : (r.error ?? '打开失败') };
    }
    const url = webLaunchUrl(e);
    if (!url) return { ok: false, message: '网页版只能通过 URL Scheme/协议打开应用，请在条目中填写' };
    window.location.href = url;
    return { ok: true, message: '已请求系统打开应用（未安装时不会有反应）' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 分享草稿到应用：
 * - Android：ACTION_SEND 定向到该包（文字 + 配图/配音文件）；
 * - iOS：系统分享面板（iOS 不能指定目标 App，由你在面板里选择）；
 * - 电脑：复制文字 → 打开草稿素材文件夹 → 打开应用；
 * - 网页：复制文字 → 支持 Web Share 时调起系统分享，否则尝试用 Scheme 打开应用。
 */
export async function shareToLocalApp(e: LocalAppEntry | null, draft: { id: number; text: string; assets?: ShareAsset[] }): Promise<ActionResult> {
  const rt = runtime();
  const files = (draft.assets ?? []).filter((a) => a.type === 'image' || a.type === 'audio').map((a, i) => {
    const ext = (a.url.split('?')[0]!.split('.').pop() ?? 'bin').toLowerCase();
    return { url: mediaUrl(a.url), name: `draft-${draft.id}-${i + 1}.${ext}`, mime: MIME[ext] ?? 'application/octet-stream' };
  });
  try {
    if (rt === 'capacitor') {
      const token = localStorage.getItem('ca.token') ?? '';
      const headers: Record<string, string> = token ? { 'x-access-token': token } : {};
      await copyText(draft.text);
      await LocalApps.share({ packageName: e?.os === 'android' ? (e.package_name ?? undefined) : undefined, text: draft.text, files: files.filter((f) => /^https?:/.test(f.url)), headers });
      return { ok: true, message: '已调起分享，正文也已复制；请在 App 中确认并由你本人发布' };
    }
    if (rt === 'electron') {
      const r = await electronBridge()!.localApp!.share({ text: draft.text, draftId: draft.id, execPath: e?.exec_path, protocol: e?.protocol });
      if (!r.ok) return { ok: false, message: `已复制正文，但打开应用失败：${r.error ?? ''}` };
      return { ok: true, message: `已复制正文${r.mediaDir ? '并打开素材文件夹' : ''}${e ? '，已打开应用' : ''}；请粘贴后由你本人发布` };
    }
    const copied = await copyText(draft.text);
    const nav = navigator as Navigator & { share?: (d: { text?: string; title?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      await nav.share({ text: draft.text });
      return { ok: true, message: '已调起系统分享' };
    }
    const url = e ? webLaunchUrl(e) : null;
    if (url) window.location.href = url;
    return { ok: copied, message: copied ? `已复制正文${url ? '，正在打开应用' : ''}；请粘贴后由你本人发布` : '复制失败，请手动复制' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
