/**
 * 长期记忆规则（6.8 / 8.5）：条目带来源、证据、日期、确定度、条件；写入需确认（memory_propose → 记忆卡 → 用户点“记住”）；
 * 范围不得比用户说的更宽（“这篇用竖图”不能记成“永远用竖图”）；纠正改写原条目；“忘掉 X”→ 检索 → 列出 → 确认 → 删除 → 再检索验证 0 → 写“不要记住”规则。
 */
export interface MemoryEntry { id: string; text: string; scope: string; condition?: string; source: 'user_said' | 'user_edited' | 'inferred'; evidence?: string; createdAt: string; updatedAt: string; confidence: 'stated' | 'inferred'; active: boolean; basis?: string }
/** 一次性说法（“这次先随便出一张”“这篇用竖图”）只进 daily，不升级为偏好。 */
export function isOneOff(text: string): boolean { return /(这次|这一次|这篇|这张|这条|今天先|先随便|暂时)/.test(text) && !/(以后|每次|一直|都|总是|永远)/.test(text); }
/** 不记的类别：密钥、密码、验证码、证件 / 银行卡、一次性数值。 */
export function forbiddenToRemember(text: string): string | null {
  if (/(密码|验证码|api\s*key|sk-|身份证|银行卡|卡号|cvv)/i.test(text)) return '密钥、密码、验证码、证件与银行卡信息不记';
  if (/(阅读量|播放量|余额|价格).{0,4}\d/.test(text) && !/(以后|每次)/.test(text)) return '一次性数值不记（放当天日志）';
  return null;
}
/** 生成提议：保留条件；推断的标 inferred 并要求写依据。 */
export function proposeMemory(text: string, o: { source: MemoryEntry['source']; condition?: string; evidence?: string; basis?: string; scope?: string; now?: Date }): { ok: true; entry: MemoryEntry } | { ok: false; reason: string } {
  const bad = forbiddenToRemember(text);
  if (bad) return { ok: false, reason: bad };
  if (isOneOff(text)) return { ok: false, reason: '这是这一次的说法，只记在当天日志，不升级为长期偏好' };
  if (o.source === 'inferred' && !o.basis) return { ok: false, reason: '推断出来的偏好必须写依据' };
  const at = (o.now ?? new Date()).toISOString();
  return { ok: true, entry: { id: `mem-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: text.trim(), scope: o.scope ?? '全局', condition: o.condition, source: o.source, evidence: o.evidence, createdAt: at, updatedAt: at, confidence: o.source === 'inferred' ? 'inferred' : 'stated', active: true, basis: o.basis } };
}
/** 同主题的新说法改写原条目（不保留矛盾的两条）。topicKey 由调用方给（如 “配图比例”）。 */
export function upsertMemory(list: MemoryEntry[], entry: MemoryEntry, sameTopic: (a: MemoryEntry, b: MemoryEntry) => boolean): MemoryEntry[] {
  const i = list.findIndex((x) => x.active && sameTopic(x, entry) && (x.condition ?? '') === (entry.condition ?? ''));
  if (i < 0) return [...list, entry];
  const old = list[i]!;
  const merged = { ...entry, id: old.id, createdAt: old.createdAt, text: `${entry.text}（此前为：${old.text.replace(/（此前为：.*?）/, '')}，${entry.updatedAt.slice(0, 7)} 改）` };
  return list.map((x, k) => (k === i ? merged : x));
}
/** 关键词检索（bigram 交集），供“忘掉 X”。 */
export function searchMemory(list: MemoryEntry[], query: string): MemoryEntry[] {
  const q = query.replace(/^(忘掉|忘记|别记|不要记)(我)?/, '').replace(/[，。！？\s]/g, '');
  if (!q) return [];
  const grams = new Set<string>(); for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2)); if (q.length === 1) grams.add(q);
  return list.filter((e) => e.active && [...grams].some((g) => e.text.includes(g)) && [...grams].filter((g) => e.text.includes(g)).length >= Math.max(1, Math.ceil(grams.size / 2)));
}
export interface ForgetResult { removed: MemoryEntry[]; remaining: MemoryEntry[]; verifyHits: number; rule: string }
/** 删除并验证（软删除由存储层负责回收站 30 天）。 */
export function forget(list: MemoryEntry[], query: string, confirmedIds: string[], now = new Date()): ForgetResult {
  const removed = list.filter((e) => confirmedIds.includes(e.id));
  const remaining = list.filter((e) => !confirmedIds.includes(e.id));
  const verifyHits = searchMemory(remaining, query).length;
  return { removed, remaining, verifyHits, rule: `- 不要记住：${query.replace(/^(忘掉|忘记)/, '')}（用户 ${now.toISOString().slice(0, 10)} 要求）` };
}
