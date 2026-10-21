/** 运行环境识别：网页（PWA）、Capacitor（Android/iOS）、Electron（桌面）。 */
export type Runtime = 'web' | 'capacitor' | 'electron';
export type Device = 'phone' | 'tablet' | 'desktop' | 'web';

interface CapGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string }
interface ElectronBridge { isElectron: true; openExternal: (url: string) => void }

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

/** 服务地址：网页版同源；App 版由用户填写（保存在本机）。 */
export function serverBase(): string {
  if (runtime() === 'web') return '';
  return (localStorage.getItem('ca.server') ?? '').replace(/\/+$/, '');
}

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
