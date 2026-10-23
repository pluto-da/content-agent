/**
 * 界面文案（1.0 起统一为 id 制，ADR-007 重审）：
 * - 文案表在 src/locales/zh.ts（源语言）与 src/locales/en.ts（必须逐条齐全，缺失 0 由 i18n 测试与 scripts/i18n-audit.mjs 校验）；
 * - 组件里写 t('ui.xxx')（hook，useT）或 tr('ui.xxx')（非 hook，读当前语言；App 每次渲染同步当前语言）；
 * - 兼容：传入中文原文（来自数据表的动态文案，如能力名、分段标签）时按中文反查 id，再取对应语言；查不到原样返回，不显示 id。
 */
import { createContext, useContext } from 'react';
import { ZH_UI } from './locales/zh';
import { EN_UI } from './locales/en';

export type Lang = 'zh' | 'en';
const ZH2ID = new Map<string, string>(Object.entries(ZH_UI).map(([id, zh]) => [zh, id]));
/** id 或中文原文 → id（查不到返回 undefined）。 */
export function idOf(key: string): string | undefined { return key in ZH_UI ? key : ZH2ID.get(key); }
export function translate(lang: Lang, key: string): string {
  const id = idOf(key);
  if (!id) { if (lang === 'en' && /[\u4e00-\u9fff]/.test(key) && MISSES.size < 2000) MISSES.add(key); return key; }
  return lang === 'en' ? (EN_UI[id] ?? ZH_UI[id]!) : ZH_UI[id]!;
}
/** 运行时漏翻记录（英文界面下传入了不在文案表里的中文）：审计 / 截图脚本读 window.__caI18nMiss。 */
const MISSES = new Set<string>();
export function i18nMisses(): string[] { return [...MISSES]; }
if (typeof window !== 'undefined') (window as unknown as { __caI18nMiss?: () => string[] }).__caI18nMiss = i18nMisses;
let currentLang: Lang = 'zh';
export function setUiLang(l: Lang): void { currentLang = l; }
export function uiLang(): Lang { return currentLang; }
/** 非 hook 的取文案（JSX 属性、读屏标签、工具函数里用）。 */
export const tr = (key: string): string => translate(currentLang, key);
/** 英文缺失的 id（应为空数组）。 */
export function missingEn(): string[] { return Object.keys(ZH_UI).filter((id) => !EN_UI[id]?.trim() && ZH_UI[id] !== '个'); }

export const LangContext = createContext<{ lang: Lang; t: (k: string) => string }>({ lang: 'zh', t: (k) => translate('zh', k) });
export const useT = () => useContext(LangContext);
