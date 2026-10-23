/**
 * 扩展点目录（ADR-001/002，ROADMAP 引用）：每个扩展点 = 一个注册表 + 一个接口；新增一项只加一个文件（或一条数据）。
 * 平台（PlatformDef）：web/src/data/platforms.ts 的 CENTERS 注册到 PLATFORMS；新增平台 = 一条数据（官方网址、包名、Scheme），
 * 不提供任何自动发布 / 互动能力（硬边界）——平台扩展点只有“打开官方页 / 官方 App、复制、发布前检查”。
 */
import { Registry } from './registry.js';
export interface PlatformDef { id: string; label: string; url: string; publishUrl: string; hosts: string[]; android?: string; ios?: string; webNote?: string; capabilities: ('open_web' | 'open_app' | 'copy' | 'checklist' | 'split_screen' | 'adapt' | 'data_import')[]; source?: 'builtin' | 'user' }
export const PLATFORMS = new Registry<PlatformDef>('平台');
export function registerPlatforms(list: Omit<PlatformDef, 'capabilities'>[]): void {
  for (const p of list) if (!PLATFORMS.has(p.id)) PLATFORMS.register({ ...p, capabilities: ['open_web', 'open_app', 'copy', 'checklist', 'split_screen', 'adapt', 'data_import'], source: 'builtin' });
}
/** 1.2.0：用户平台（VFS platforms/<id>/PLATFORM.md）并入同一个注册表；内置同 id 优先（不覆盖），能力与内置完全相同。返回因 id 冲突未并入的平台。 */
export function registerUserPlatforms(list: Omit<PlatformDef, 'capabilities' | 'source'>[]): string[] {
  const skipped: string[] = [];
  for (const p of list) {
    const cur = PLATFORMS.get(p.id);
    if (cur && cur.source !== 'user') { skipped.push(p.id); continue; }
    PLATFORMS.replace({ ...p, capabilities: ['open_web', 'open_app', 'copy', 'checklist', 'split_screen', 'adapt', 'data_import'], source: 'user' });
  }
  return skipped;
}
export interface ExtensionPoint { id: string; label: string; contract: string; registry: string; addBy: string; since: string }
export const EXTENSION_POINTS: ExtensionPoint[] = [
  { id: 'model-adapter', label: '模型服务商', contract: 'shared/src/models/adapters/types.ts#Adapter', registry: 'ADAPTERS', addBy: '新建 adapters/<vendor>.ts + 在 adapters/index.ts 列表加一行', since: '0.9.0' },
  { id: 'model-role', label: '能力角色', contract: 'shared/src/models/roles.ts#RoleDef', registry: 'ROLES', addBy: '注册角色 + 适配器支持 + 卡片', since: '0.9.0' },
  { id: 'agent-tool', label: 'Agent 工具', contract: 'shared/src/agent/tools.ts#ToolSpec', registry: 'ToolRegistry', addBy: 'web/src/agent/v9/tools.ts 注册；对外写入类名字被注册表拒绝', since: '0.9.0' },
  { id: 'skill', label: '技能', contract: 'SKILL.md front matter（name/description/roles/tools/version/source）', registry: 'VFS skills/', addBy: '在“我的 → 技能”新建，或放入 skills/<name>/SKILL.md', since: '0.8.0' },
  { id: 'platform', label: '平台', contract: 'shared/src/core/extensions.ts#PlatformDef', registry: 'PLATFORMS', addBy: '内置：web/src/data/platforms.ts 加一条；1.2 起用户可在 App 内“＋ 添加平台”（platforms/<id>/PLATFORM.md，模板 / 一句话 / .platform.zip），能力只有打开 / 复制 / 检查 / 分屏 / 适配 / 数据导入', since: '0.7.0' },
  { id: 'feature-flag', label: '特性开关', contract: 'shared/src/core/flags.ts#FeatureFlag', registry: 'FLAGS', addBy: 'flags.ts 注册（reserved 强制关闭）', since: '0.9.0' },
  { id: 'migration', label: '数据迁移', contract: 'shared/src/core/migrate.ts#MigrationStep', registry: 'ALL_MIGRATORS', addBy: '对应 Migrator.add({from,to,up,down}) + 单测', since: '0.9.0' },
  { id: 'sync', label: '同步（预留）', contract: 'shared/src/core/sync.ts#SyncPort', registry: 'DisabledSync', addBy: '1.1 起按 ROADMAP 实现；默认关闭，不做多账号', since: '0.9.0' },
  { id: 'locale', label: '语言', contract: 'shared/src/core/i18n.ts#Catalog', registry: 'CATALOGS', addBy: '新增目录对象，缺失 id 回退中文', since: '0.9.0' },
];
