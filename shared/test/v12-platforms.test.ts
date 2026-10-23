import { describe, it, expect } from 'vitest';
import { PLATFORM_TEMPLATES, PLATFORM_CAPABILITIES, PLATFORM_NOTICE, SPEC_KEYS, UNVERIFIED, platformFromTemplate, draftPlatformFromSentence, exportPlatformZip, importPlatformZip, serializePlatformMd, parsePlatformMd, validatePlatform, mergePlatforms, checklistFor, platformPath, checkName, registerUserPlatforms, PLATFORMS, registerPlatforms, zip, utf8 } from '../src/index.js';

describe('E11 自定义平台', () => {
  it('三种创建方式：模板复制 / 一句话起草 / 导入 .platform.zip', () => {
    const a = platformFromTemplate('bilibili', { id: 'bili-main', name: 'B站主号写法' });
    expect(a.readonly).toBe(false); expect(a.source).toBe('user'); expect(validatePlatform(a)).toEqual([]);
    const d = draftPlatformFromSentence('加一个叫少数派的长文社区 https://sspai.com 主要写文章');
    expect(d.manifest.id).toBe('sspai'); expect(d.manifest.name).toBe('少数派'); expect(d.manifest.forms).toContain('long_article'); expect(d.manifest.createdBy).toBe('super');
    expect(validatePlatform(d.manifest)).toEqual([]); expect(d.skill.path).toBe('skills/sspai/SKILL.md');
    expect(SPEC_KEYS.every((k) => !d.manifest.spec[k].verified)).toBe(true);
    const z = exportPlatformZip(d.manifest, d.skill.content);
    const im = importPlatformZip(z);
    expect(im.ok).toBe(true); expect(im.manifest?.name).toBe('少数派'); expect(im.skill).toMatch(/写法/);
  });
  it('能力与内置平台完全一致，且没有自动发布 / 互动', () => {
    for (const t of PLATFORM_TEMPLATES) { expect(t.capabilities).toEqual([...PLATFORM_CAPABILITIES]); expect(validatePlatform(t)).toEqual([]); expect(checkName(platformPath(t.id))).toBeNull(); }
    expect(PLATFORM_CAPABILITIES.join()).not.toMatch(/publish|post|comment|like|follow/);
    const m = platformFromTemplate('weibo', { id: 'wb2' });
    expect(validatePlatform({ ...m, capabilities: [...m.capabilities, 'auto_publish' as never] }).join()).toMatch(/硬边界/);
    const bad = new TextDecoder().decode(exportPlatformZip(m)).includes('PLATFORM.md');
    expect(bad).toBe(true);
    const evil = serializePlatformMd(m).replace('capabilities: [', 'capabilities: [auto_comment, ');
    const im = importPlatformZip(zip([{ path: 'PLATFORM.md', data: utf8(evil) }]));
    expect(im.ok).toBe(false); expect(im.errors.join()).toMatch(/硬边界/);
    expect(checklistFor(m).every((c) => c.byUser)).toBe(true);
    expect(serializePlatformMd(m)).toContain(PLATFORM_NOTICE);
  });
  it('PLATFORM.md 往返；路径合法；导入 Key 扫描', () => {
    const t = platformFromTemplate('youtube');
    const back = parsePlatformMd(serializePlatformMd(t));
    expect(back.spec).toEqual(t.spec); expect(back.checklist).toEqual(t.checklist); expect(back.metrics).toEqual(t.metrics); expect(back.hosts).toEqual(t.hosts);
    expect(checkName(platformPath('bilibili'))).toBeNull();
    const leak = serializePlatformMd(t).replace('# YouTube', '# YouTube sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(importPlatformZip(zip([{ path: 'PLATFORM.md', data: utf8(leak) }])).ok).toBe(false);
  });
  it('PLATFORMS 两源合并：内置优先，用户平台并入，id 冲突提示', () => {
    const builtin = [{ id: 'xiaohongshu', label: '小红书', url: 'https://creator.xiaohongshu.com/', publishUrl: 'https://creator.xiaohongshu.com/', hosts: ['xiaohongshu.com'] }];
    const u1 = platformFromTemplate('bilibili'); const u2 = platformFromTemplate('xiaohongshu');
    const m = mergePlatforms(builtin, [u1, u2, PLATFORM_TEMPLATES[0]!]);
    expect(m.list.map((x) => `${x.id}:${x.source}`)).toEqual(['xiaohongshu:builtin', 'bilibili:user']);
    expect(m.conflicts).toEqual(['xiaohongshu']);
    registerPlatforms([{ id: 'zz-builtin', label: 'Z', url: 'https://z.example.com', publishUrl: 'https://z.example.com', hosts: ['z.example.com'] }]);
    expect(registerUserPlatforms([{ id: 'zz-builtin', label: 'mine', url: 'https://z.example.com', publishUrl: '', hosts: [] }, { id: 'zz-user', label: 'U', url: 'https://u.example.com', publishUrl: '', hosts: [] }])).toEqual(['zz-builtin']);
    expect(PLATFORMS.get('zz-user')?.capabilities).toEqual(PLATFORMS.get('zz-builtin')?.capabilities);
    expect(PLATFORMS.get('zz-user')?.source).toBe('user');
  });
});

describe('E12 平台模板规格附来源与核对日期', () => {
  it('14 个模板（7 个既有 + 7 个新增）；已核实字段都有来源与核对日期，其余标“待核实”', () => {
    expect(PLATFORM_TEMPLATES.map((t) => t.id)).toEqual(['douyin', 'xiaohongshu', 'channels', 'wechat_mp', 'zhihu', 'xianyu', 'x', 'bilibili', 'kuaishou', 'weibo', 'douban', 'xiaoyuzhou', 'youtube', 'instagram']);
    let verified = 0, unverified = 0;
    for (const t of PLATFORM_TEMPLATES) for (const k of SPEC_KEYS) {
      const f = t.spec[k];
      if (f.verified) { verified++; expect(f.source).toMatch(/^https:\/\//); expect(f.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(f.value).not.toBeNull(); }
      else { unverified++; expect(f.value).toBeNull(); }
    }
    expect(verified).toBeGreaterThanOrEqual(4); expect(unverified).toBeGreaterThan(0);
    expect(serializePlatformMd(PLATFORM_TEMPLATES[0]!)).toContain(UNVERIFIED);
    expect(PLATFORM_TEMPLATES.find((t) => t.id === 'youtube')!.spec.titleMax.value).toBe(100);
  });
});
