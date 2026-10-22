/** 主包里的轻量公共函数（避免今天页、外壳为了几个常量把整页模块拉进主包）。 */
import { get } from './api';
import type { KnownApp, LocalAppEntry } from './native';
import type { AppOs } from './runtime';
import { useLoad } from './ui';

export const PLATFORM_LABEL: Record<string, string> = { xiaohongshu: '小红书', douyin_script: '抖音', channels: '视频号', wechat_article: '公众号', xianyu: '闲鱼', x_post: 'X', zhihu_answer: '知乎回答', zhihu_article: '知乎文章' };
export const OS_LABEL: Record<AppOs, string> = { android: 'Android', ios: 'iOS', windows: 'Windows', mac: 'macOS' };

export interface LocalAppsData { apps: (LocalAppEntry & { id: number })[]; known: KnownApp[] }
export function useLocalApps(version = 0) {
  return useLoad<LocalAppsData>(() => get('/api/local-apps'), [version]);
}

/** 某平台在本机系统上的预设条目（官方包名 / Scheme）。 */
export function presetFor(known: KnownApp[], platform: string, os: AppOs): LocalAppEntry {
  const k = known.find((x) => x.platform === platform);
  const base: LocalAppEntry = { platform, os, label: k?.label ?? platform };
  if (os === 'android') return { ...base, package_name: k?.android ?? '' };
  if (os === 'ios') return { ...base, url_scheme: k?.ios ?? '' };
  return { ...base, protocol: '', exec_path: '' };
}

export function ago(ts: string | undefined, lang: string): string {
  if (!ts) return '';
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return ts;
  const s = Math.max(0, (Date.now() - t) / 1000);
  const zh = lang === 'zh';
  if (s < 60) return zh ? '刚刚' : 'just now';
  if (s < 3600) return zh ? `${Math.floor(s / 60)} 分钟前` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return zh ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 3600)}h ago`;
  return zh ? `${Math.floor(s / 86400)} 天前` : `${Math.floor(s / 86400)}d ago`;
}
