/**
 * 0.7.0 内置平台：
 * A. 在 App 内打开各平台官方网页版（Android：自写原生 WebView 页面 InAppWebActivity，带工具栏；iOS：系统内置浏览器
 *    SFSafariViewController；电脑 / 网页：新标签页或系统浏览器）。用户在内置页里自己登录、浏览、发布。
 * B. 平板分屏：用 FLAG_ACTIVITY_LAUNCH_ADJACENT 打开已登记的官方 App，放在本 App 旁边。
 *
 * 硬边界：不向第三方页面注入任何脚本、不自动填表、不自动点击发布 / 点赞 / 评论 / 私信 / 关注；
 * 不读取第三方页面内容或 Cookie 给本 App 使用（“退出登录”只在原生层删除该平台站点的数据）；不做多账号；
 * 发布永远由用户本人点击。
 */
import { registerPlugin } from '@capacitor/core';
import type { Center } from './data/platforms';
import { launchLocalApp, type ActionResult, type LocalAppEntry } from './native';
import { appOs, copyText, electronBridge, runtime, type AppOs, type Runtime } from './runtime';

interface BuiltinWebPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  open(o: { url: string; title: string; platform: string; packageName?: string; hint?: string; hosts: string[] }): Promise<void>;
  clearData(o: { hosts: string[] }): Promise<{ cleared: number }>;
  clearAll(): Promise<void>;
}
interface SplitScreenPlugin {
  info(): Promise<{ sdk: number; supported: boolean; inMultiWindow: boolean; largeScreen: boolean }>;
  openAdjacent(o: { packageName: string }): Promise<{ adjacent: boolean; inMultiWindow: boolean }>;
}
export const BuiltinWeb = registerPlugin<BuiltinWebPlugin>('BuiltinWeb');
export const SplitScreen = registerPlugin<SplitScreenPlugin>('SplitScreen');

/** 内置网页怎么打开：native = Android 原生 WebView 页；sheet = iOS 系统内置浏览器；tab = 电脑 / 网页新标签页。 */
export type BuiltinMode = 'native' | 'sheet' | 'tab';
export function builtinMode(rt: Runtime = runtime(), os: AppOs | null = appOs()): BuiltinMode {
  if (rt === 'capacitor') return os === 'android' ? 'native' : 'sheet';
  return 'tab';
}

/** 平板 / 大屏：屏幕短边 ≥ 600 CSS px（≈ Android 的 smallestScreenWidthDp ≥ 600）。 */
export function isLargeScreen(w: Pick<Window, 'innerWidth' | 'innerHeight'> & { screen?: { width: number; height: number } } = window): boolean {
  const sw = w.screen?.width || w.innerWidth;
  const sh = w.screen?.height || w.innerHeight;
  return Math.min(sw, sh) >= 600;
}

export interface Env { rt: Runtime; os: AppOs | null; large: boolean }
export const currentEnv = (): Env => ({ rt: runtime(), os: appOs(), large: isLargeScreen() });

/** “分屏打开”按钮只在 Android App + 平板 / 大屏上出现，且该平台登记了 Android 包名。 */
export function canSplitScreen(env: Env = currentEnv(), entry?: Pick<LocalAppEntry, 'os' | 'package_name'> | null): boolean {
  if (env.rt !== 'capacitor' || env.os !== 'android' || !env.large) return false;
  return entry === undefined || (!!entry && entry.os === 'android' && !!entry.package_name);
}

/** 退出登录 / 清除数据只在 Android 原生内置页有意义（其他终端的数据在系统浏览器里）。 */
export const canClearBuiltin = (env: Env = currentEnv()) => builtinMode(env.rt, env.os) === 'native';

export function builtinPublishLabel(c: Pick<Center, 'label'>, mode: BuiltinMode = builtinMode()): string {
  return mode === 'tab' ? `在新标签页打开${c.label}发布` : `在软件内打开${c.label}发布`;
}
export function builtinOpenLabel(c: Pick<Center, 'label'>, mode: BuiltinMode = builtinMode()): string {
  return mode === 'tab' ? `打开${c.label}网页版` : `打开${c.label}（内置）`;
}
export const splitLabel = (c: Pick<Center, 'label'>) => `分屏打开${c.label}`;

export const PASTE_HINT = '文案已复制。在发布框里长按粘贴，最后由你本人点击发布。';

export interface BuiltinResult extends ActionResult {
  /** 内置网页打不开：界面应显示原因并提供“打开官方 App” */
  fallbackApp?: boolean;
  copied?: boolean;
}

const rawMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));
/** 插件缺失（装的是 0.7.0 以前的 App）时 Capacitor 报英文 “… plugin is not implemented on android”，换成白话。 */
export const errMsg = (e: unknown) => (/not implemented/i.test(rawMsg(e)) ? '当前安装的 App 版本不支持这个功能，请安装 0.7.0 或更新版本' : rawMsg(e));

/** 打开某平台的官方网页版（publish=true 时直接到发布页）。 */
export async function openBuiltin(c: Center, o: { publish?: boolean; url?: string; hint?: string; packageName?: string } = {}): Promise<BuiltinResult> {
  const url = o.url ?? (o.publish ? c.publishUrl : c.url);
  if (!/^https:\/\//.test(url)) return { ok: false, message: '只能打开 https 官方网址', fallbackApp: true };
  const mode = builtinMode();
  try {
    if (mode === 'native') {
      const av = await BuiltinWeb.isAvailable().catch((e) => ({ available: false, reason: errMsg(e) }));
      if (!av.available) {
        return { ok: false, fallbackApp: true, message: `内置网页打不开：${av.reason || '这台手机的系统 WebView 不可用或已停用'}。可以改用官方 App。` };
      }
      await BuiltinWeb.open({ url, title: c.label, platform: c.id, packageName: o.packageName ?? c.android, hint: o.hint, hosts: c.hosts });
      return { ok: true, message: `已在软件内打开${c.label}` };
    }
    if (mode === 'sheet') {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return { ok: true, message: `已在软件内打开${c.label}` };
    }
    const bridge = electronBridge();
    if (bridge) { bridge.openExternal(url); return { ok: true, message: `已在浏览器打开${c.label}` }; }
    const w = window.open(url, '_blank');
    if (!w) return { ok: false, message: '浏览器拦截了新标签页，请允许弹出窗口后再点一次', fallbackApp: false };
    try { w.opener = null; } catch { /* 跨源窗口可能不允许写 */ }
    return { ok: true, message: `已在新标签页打开${c.label}` };
  } catch (e) {
    return { ok: false, fallbackApp: true, message: `内置网页打开失败：${errMsg(e)}。可以改用官方 App。` };
  }
}

/** “在软件内打开 X 发布”：先复制文案，再打开该平台网页版发布页，并提示由你本人点击发布。 */
export async function copyAndOpenBuiltin(c: Center, text: string, o: { url?: string; packageName?: string } = {}): Promise<BuiltinResult> {
  const copied = await copyText(text);
  const r = await openBuiltin(c, { publish: true, url: o.url, packageName: o.packageName, hint: copied ? PASTE_HINT : '复制失败：请回到本软件长按正文手动复制，发布由你本人点击。' });
  const head = copied ? '文案已复制。' : '复制失败，请长按正文手动复制。';
  if (!r.ok) return { ...r, copied, message: `${head}${r.message}` };
  return { ...r, copied, message: `${head}${r.message}发布页，粘贴后由你本人点击发布。` };
}

/** 平板分屏打开官方 App；不支持分屏时正常打开并提示。 */
export async function openSplit(entry: LocalAppEntry, label: string, env: Env = currentEnv()): Promise<ActionResult> {
  if (!canSplitScreen(env, entry)) {
    const r = await launchLocalApp(entry);
    return r.ok ? { ok: true, message: `这台设备不支持分屏，已正常打开${label}` } : r;
  }
  try {
    const r = await SplitScreen.openAdjacent({ packageName: entry.package_name ?? '' });
    return r.adjacent
      ? { ok: true, message: `已请求在旁边分屏打开${label}。如果没有分屏，可从“最近任务”里手动分屏。` }
      : { ok: true, message: `这台设备不支持分屏，已正常打开${label}` };
  } catch (e) {
    const m = errMsg(e);
    if (/NOT_INSTALLED|未安装/.test(m)) return { ok: false, message: `没有找到${label}，请先在手机上安装官方 App` };
    const r = await launchLocalApp(entry);
    return r.ok ? { ok: true, message: `分屏失败，已正常打开${label}` } : { ok: false, message: `分屏失败：${m}` };
  }
}

/** 退出某平台在内置网页里的登录（删除该平台站点的 Cookie 与网页存储）。 */
export async function clearBuiltin(c: Center): Promise<ActionResult> {
  if (builtinMode() !== 'native') return { ok: false, message: '网页版的登录保存在浏览器里，请在浏览器设置中清除该网站数据' };
  try {
    await BuiltinWeb.clearData({ hosts: c.hosts });
    const shared = c.hosts.includes('weixin.qq.com') ? '（公众号与视频号共用微信登录，会一起退出）' : '';
    return { ok: true, message: `已退出${c.label}的内置网页登录${shared}` };
  } catch (e) {
    return { ok: false, message: `清除失败：${errMsg(e)}` };
  }
}

export async function clearAllBuiltin(): Promise<ActionResult> {
  if (builtinMode() !== 'native') return { ok: false, message: '只有安卓 App 有内置网页数据' };
  try { await BuiltinWeb.clearAll(); return { ok: true, message: '已清除全部内置网页的登录与数据' }; } catch (e) { return { ok: false, message: `清除失败：${errMsg(e)}` }; }
}
