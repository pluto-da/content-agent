/** 安卓 / iOS 状态栏：不让 WebView 画到状态栏下面；浅色主题深色图标、深色主题浅色图标。 */
import { StatusBar, Style } from '@capacitor/status-bar';

export async function applyStatusBar(dark: boolean): Promise<void> {
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0a0a0a' : '#fafafa' }).catch(() => {});
  } catch { /* 网页 / 不支持的平台：忽略，CSS 安全区兜底 */ }
}

export async function initStatusBar(): Promise<void> {
  const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  await applyStatusBar(!!dark);
  new MutationObserver(() => {
    const t = document.documentElement.dataset.theme;
    void applyStatusBar(t === 'dark' || (t !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
