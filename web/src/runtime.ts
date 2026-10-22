/** 运行环境识别：网页（PWA）、Capacitor（Android/iOS）、Electron（桌面）。 */
export type Runtime = 'web' | 'capacitor' | 'electron';
export type Device = 'phone' | 'tablet' | 'desktop' | 'web';

interface CapGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string }
export type LoginState = 'saved' | 'none' | 'expired';
export interface ElectronBridge {
  isElectron: true;
  platform?: string;
  openExternal: (url: string) => void;
  creator?: { lastUrl: (id: string) => Promise<string | null>; status: (ids?: string[]) => Promise<Record<string, LoginState>>; logout: (id: string) => Promise<{ ok: boolean }> };
  localApp?: {
    pick: () => Promise<string | null>;
    launch: (o: { execPath?: string | null; protocol?: string | null }) => Promise<{ ok: boolean; error?: string }>;
    share: (o: { text: string; draftId?: number; execPath?: string | null; protocol?: string | null }) => Promise<{ ok: boolean; error?: string; copied?: boolean; mediaDir?: string | null }>;
  };
}

export function electronBridge(w: Window = window): ElectronBridge | undefined {
  return (w as unknown as { contentAgent?: ElectronBridge }).contentAgent;
}

/** 本机系统（用于“本地应用”选择对应的条目）。网页版根据 UA 推断，桌面浏览器返回 windows/mac。 */
export type AppOs = 'android' | 'ios' | 'windows' | 'mac';
export function appOs(w: Window = window): AppOs | null {
  const rt = runtime(w);
  if (rt === 'capacitor') {
    const p = (w as unknown as { Capacitor?: CapGlobal }).Capacitor?.getPlatform?.();
    return p === 'android' || p === 'ios' ? p : null;
  }
  if (rt === 'electron') {
    const p = electronBridge(w)?.platform;
    return p === 'win32' ? 'windows' : p === 'darwin' ? 'mac' : null;
  }
  const ua = w.navigator?.userAgent ?? '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return null;
}

export function runtime(w: Window = window): Runtime {
  const cap = (w as unknown as { Capacitor?: CapGlobal }).Capacitor;
  if (cap?.isNativePlatform?.()) return 'capacitor';
  if ((w as unknown as { contentAgent?: ElectronBridge }).contentAgent?.isElectron) return 'electron';
  return 'web';
}

export function deviceClass(width: number, rt: Runtime): Device {
  if (rt === 'web' && width >= 1200) return 'web';
  if (width < 768) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

/**
 * 0.6.0：默认本机模式，不需要任何服务器。只有用户在“我的 → 连接服务器”测试连通后才走服务端。
 * 返回服务器基地址（'' 表示与网页同源），未连接返回 null。
 */
export function connectedServer(): string | null {
  if (typeof localStorage === 'undefined' || localStorage.getItem('ca.mode') !== 'server') return null;
  return (localStorage.getItem('ca.server') ?? '').trim().replace(/\/+$/, '');
}
/** 兼容旧调用：未连接服务器时为空串。 */
export function serverBase(): string { return connectedServer() ?? ''; }

export async function openExternal(url: string): Promise<void> {
  const rt = runtime();
  if (rt === 'capacitor') {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return;
  }
  if (rt === 'electron') {
    (window as unknown as { contentAgent: ElectronBridge }).contentAgent.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function notify(title: string, body: string): Promise<boolean> {
  if (runtime() === 'capacitor') {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return false;
    await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title, body }] });
    return true;
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return false;
  new Notification(title, { body, icon: '/icon-192.png' });
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
