/**
 * 通用注册表（ADR-001）：服务商适配器、能力角色、平台、技能、工具、特性开关、迁移都走同一种注册表。
 * 新增一项 = 新建一个文件并调用 register()（或放进该类别的 barrel 列表），核心代码不改。
 * 规则：id 唯一（重复注册报错，防止两份实现悄悄覆盖）；冻结后不可再注册（测试与运行时一致性）。
 */
export interface Registered { readonly id: string }

export class Registry<T extends Registered> {
  private items = new Map<string, T>();
  private frozen = false;
  constructor(readonly kind: string) {}
  register(item: T): T {
    if (this.frozen) throw new Error(`${this.kind} 注册表已冻结，不能再注册 ${item.id}`);
    if (!item.id || !/^[A-Za-z0-9][\w.-]{0,63}$/.test(item.id)) throw new Error(`${this.kind} id 不合法：${item.id}`);
    if (this.items.has(item.id)) throw new Error(`${this.kind} 重复注册：${item.id}`);
    this.items.set(item.id, item);
    return item;
  }
  /** 测试 / 热替换用：只在未冻结时允许。 */
  replace(item: T): T { if (this.frozen) throw new Error(`${this.kind} 注册表已冻结`); this.items.set(item.id, item); return item; }
  get(id: string): T | undefined { return this.items.get(id); }
  must(id: string): T { const v = this.items.get(id); if (!v) throw new Error(`未知的${this.kind}：${id}`); return v; }
  has(id: string): boolean { return this.items.has(id); }
  list(): T[] { return [...this.items.values()]; }
  ids(): string[] { return [...this.items.keys()]; }
  freeze(): this { this.frozen = true; return this; }
  get isFrozen(): boolean { return this.frozen; }
}
