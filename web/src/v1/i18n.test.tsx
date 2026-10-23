/** 1.0 文案 id 制：zh / en 一一对应、英文缺失 0；中文原文反查 id（动态文案）；tr 跟随当前语言；读屏标签走文案表。 */
import { describe, expect, it } from 'vitest';
import { ZH_UI } from '../locales/zh';
import { EN_UI } from '../locales/en';
import { translate, idOf, tr, setUiLang, missingEn } from '../i18n';

describe('界面文案 id 制', () => {
  it('英文缺失 0，id 一一对应，插值与换行一致', () => {
    expect(missingEn()).toEqual([]);
    expect(Object.keys(EN_UI).sort()).toEqual(Object.keys(ZH_UI).sort());
    for (const id of Object.keys(ZH_UI)) expect(id).toMatch(/^ui\.[a-z0-9_]+$/);
  });
  it('按 id 与按中文原文都能取到英文；查不到原样返回（不显示 id）', () => {
    const id = idOf('首页')!;
    expect(id).toMatch(/^ui\./);
    expect(translate('en', id)).toBe('Home'); expect(translate('en', '首页')).toBe('Home'); expect(translate('zh', id)).toBe('首页');
    expect(translate('en', '这句不在表里')).toBe('这句不在表里');
  });
  it('tr 跟随当前语言', () => { setUiLang('en'); expect(tr(idOf('存储')!)).toBe('Storage'); setUiLang('zh'); expect(tr(idOf('存储')!)).toBe('存储'); });
});
