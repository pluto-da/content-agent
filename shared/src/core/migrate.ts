/**
 * 版本化迁移框架（ADR-003）：本机数据、配置文件、备份包、VFS 文件都带 schemaVersion，迁移可前滚可回滚。
 * - 每一步是纯函数 up / down，必须幂等可测：down(up(x)) 在“可逆字段”上等于 x；
 * - migrate(doc, target) 自动选择方向，逐步执行；缺步骤、版本超前（未来版本写的数据）都给白话错误而不是猜；
 * - 读到更高版本的数据（新版写、旧版读）：compat='read-only' 时允许只读（保留未知字段），不写回。
 */
export interface Versioned { schemaVersion: number }
export interface MigrationStep<A = unknown, B = unknown> {
  from: number; to: number;            // to = from + 1
  name: string;
  up: (doc: A) => B;
  down: (doc: B) => A;
}
export class MigrationError extends Error {
  constructor(public kind: 'missing_step' | 'future_version' | 'step_failed' | 'invalid', message: string) { super(message); }
}

export class Migrator<Latest extends Versioned> {
  private steps = new Map<number, MigrationStep<any, any>>();
  constructor(readonly name: string, readonly latest: number, readonly earliest = 1) {}
  add(step: MigrationStep<any, any>): this {
    if (step.to !== step.from + 1) throw new MigrationError('invalid', `${this.name}：迁移步骤必须相邻（${step.from}→${step.to}）`);
    if (this.steps.has(step.from)) throw new MigrationError('invalid', `${this.name}：重复的迁移步骤 ${step.from}→${step.to}`);
    this.steps.set(step.from, step);
    return this;
  }
  /** 检查从 earliest 到 latest 每一步都存在。 */
  validate(): string[] {
    const missing: string[] = [];
    for (let v = this.earliest; v < this.latest; v++) if (!this.steps.has(v)) missing.push(`${v}→${v + 1}`);
    return missing;
  }
  versionOf(doc: unknown): number {
    if (doc && typeof doc === 'object' && typeof (doc as Versioned).schemaVersion === 'number') return (doc as Versioned).schemaVersion;
    if (doc && typeof doc === 'object' && typeof (doc as { version?: unknown }).version === 'number') return (doc as { version: number }).version;
    return this.earliest;
  }
  migrate<T = Latest>(doc: unknown, target: number = this.latest): { doc: T; from: number; to: number; applied: string[] } {
    const from = this.versionOf(doc);
    if (from > this.latest) throw new MigrationError('future_version', `${this.name}：数据版本 ${from} 比本 App 支持的 ${this.latest} 新，请先升级 App；当前只读打开，不会写回`);
    if (target > this.latest || target < this.earliest) throw new MigrationError('invalid', `${this.name}：目标版本 ${target} 超出范围 ${this.earliest}–${this.latest}`);
    let cur: any = structuredCloneSafe(doc);
    const applied: string[] = [];
    if (from < target) {
      for (let v = from; v < target; v++) {
        const s = this.steps.get(v);
        if (!s) throw new MigrationError('missing_step', `${this.name}：缺少迁移步骤 ${v}→${v + 1}`);
        try { cur = s.up(cur); } catch (e) { throw new MigrationError('step_failed', `${this.name}：迁移 ${s.name} 失败：${(e as Error).message}`); }
        cur = { ...cur, schemaVersion: v + 1 };
        applied.push(`↑${s.name}`);
      }
    } else if (from > target) {
      for (let v = from; v > target; v--) {
        const s = this.steps.get(v - 1);
        if (!s) throw new MigrationError('missing_step', `${this.name}：缺少回滚步骤 ${v}→${v - 1}`);
        try { cur = s.down(cur); } catch (e) { throw new MigrationError('step_failed', `${this.name}：回滚 ${s.name} 失败：${(e as Error).message}`); }
        cur = { ...cur, schemaVersion: v - 1 };
        applied.push(`↓${s.name}`);
      }
    }
    return { doc: cur as T, from, to: target, applied };
  }
}

export function structuredCloneSafe<T>(v: T): T {
  if (v === undefined || v === null) return v;
  try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch { return JSON.parse(JSON.stringify(v)); }
}

/**
 * 兼容读取（未来版本写的配置 / VFS 文件）：版本 ≤ 支持版本 → 迁移到最新；版本更高 → 只读打开（readOnly=true），保留未知字段，不写回。
 */
export function compatRead<T extends Versioned>(m: Migrator<T>, doc: unknown): { doc: T; readOnly: boolean; note?: string } {
  const v = m.versionOf(doc);
  if (v > m.latest) return { doc: doc as T, readOnly: true, note: `由更新版本（${v}）写入，本版本只读打开` };
  return { doc: m.migrate<T>(doc).doc, readOnly: false };
}
