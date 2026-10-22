import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { DB } from '../db.js';
import type { ModelHub } from '../models/hub.js';
import { extractJson } from '../models/util.js';
import { parseSkill } from '../skills/loader.js';
import { schemaFor, systemPrompt } from './prompt.js';
import type { AgentFiles } from './agentfiles.js';
import { checkCompliance } from './compliance.js';

export interface EvalCase {
  id: string;
  platform: string;
  topic: string;
  checks: { minLen?: number; maxLen?: number; mustInclude?: string[]; forbid?: string[]; requireTitle?: boolean; noComplianceWarn?: boolean };
}

export interface CaseResult { id: string; passed: boolean; failures: string[]; cached?: boolean; model?: string; promptHash?: string; inputHash?: string }

/** 确定性评测参数：temperature=0，支持 seed 的服务商固定传 seed。确定性≠正确性，只让评测可复现。 */
export const EVAL_TEMPERATURE = 0;
export const EVAL_SEED = 20261022;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 结果缓存键：模型版本 + 提示词哈希 + 输入哈希 + 采样参数。 */
export function evalCacheKey(provider: string, model: string, promptHash: string, inputHash: string, seed: number | null): string {
  return sha256([provider, model, promptHash, inputHash, `t=${EVAL_TEMPERATURE}`, `seed=${seed ?? '-'}`].join('|'));
}

/**
 * 确定性调用：先查哈希缓存，命中直接复用；未命中按 temperature=0 / seed 调用并写缓存。
 * 没有 db 时不缓存（只做确定性参数）。
 */
export async function deterministicChat(hub: ModelHub, db: DB | undefined, system: string, user: string): Promise<{ content: string; cached: boolean; provider: string; model: string; promptHash: string; inputHash: string }> {
  const info = hub.resolveInfo('llm', 'eval');
  const promptHash = sha256(system);
  const inputHash = sha256(user);
  const seed = info.supportsSeed ? EVAL_SEED : null;
  const key = evalCacheKey(info.provider, info.model, promptHash, inputHash, seed);
  const hit = db?.prepare('SELECT output FROM eval_cache WHERE key = ?').get(key) as { output: string } | undefined;
  if (hit) return { content: hit.output, cached: true, provider: info.provider, model: info.model, promptHash, inputHash };
  const r = await hub.chat('eval', [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: EVAL_TEMPERATURE, ...(seed !== null ? { seed } : {}) });
  // 只缓存与解析时一致的模型（主路失败切了备用则不缓存，避免把备用结果记在主路名下）
  if (db && r.provider === info.provider && r.model === info.model) {
    db.prepare('INSERT OR REPLACE INTO eval_cache(key, provider, model, prompt_hash, input_hash, output) VALUES(?,?,?,?,?,?)').run(key, r.provider, r.model, promptHash, inputHash, r.content);
  }
  return { content: r.content, cached: false, provider: r.provider, model: r.model, promptHash, inputHash };
}

/** 可自动判定的检查项。 */
export function judge(c: EvalCase, out: { title?: string; body?: string }): CaseResult {
  const failures: string[] = [];
  const body = out.body ?? '';
  const len = [...body].length;
  if (c.checks.minLen !== undefined && len < c.checks.minLen) failures.push(`正文过短（${len} < ${c.checks.minLen}）`);
  if (c.checks.maxLen !== undefined && len > c.checks.maxLen) failures.push(`正文过长（${len} > ${c.checks.maxLen}）`);
  for (const k of c.checks.mustInclude ?? []) if (!body.includes(k)) failures.push(`缺少必含内容：${k}`);
  for (const k of c.checks.forbid ?? []) if (body.includes(k)) failures.push(`出现禁用内容：${k}`);
  if (c.checks.requireTitle && !out.title) failures.push('缺少标题');
  if (c.checks.noComplianceWarn && checkCompliance(body).some((i) => i.level === 'warn')) failures.push('存在合规警告');
  return { id: c.id, passed: failures.length === 0, failures };
}

export function loadBenchmark(file: string): EvalCase[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as EvalCase[];
}

async function runVersion(hub: ModelHub, agent: AgentFiles, skillSrc: string, cases: EvalCase[], db?: DB): Promise<{ passRate: number; results: CaseResult[]; cacheHits: number }> {
  const skill = parseSkill(skillSrc, 'eval');
  const results: CaseResult[] = [];
  let cacheHits = 0;
  for (const c of cases.filter((x) => !skill.platform || x.platform === skill.platform)) {
    try {
      const system = systemPrompt(agent, skill, schemaFor(skill, c.platform));
      const user = `[TASK:rewrite] [PLATFORM:${c.platform}]\n选题标题：${c.topic}\n请输出 JSON：{"title","body","tags"}`;
      const r = await deterministicChat(hub, db, system, user);
      if (r.cached) cacheHits++;
      results.push({ ...judge(c, extractJson<{ title?: string; body?: string }>(r.content)), cached: r.cached, model: `${r.provider}/${r.model}`, promptHash: r.promptHash.slice(0, 12), inputHash: r.inputHash.slice(0, 12) });
    } catch (e) {
      results.push({ id: c.id, passed: false, failures: [`调用失败：${e instanceof Error ? e.message : String(e)}`] });
    }
  }
  const passRate = results.length ? results.filter((r) => r.passed).length / results.length : 0;
  return { passRate, results, cacheHits };
}

/** A/B 评测：对同一 skill 的两个版本运行基准集，结果写入两个版本的 eval_result。 */
export async function abTest(hub: ModelHub, agent: AgentFiles, benchFile: string, versionA: number, versionB: number, db?: DB) {
  const a = agent.version(versionA);
  const b = agent.version(versionB);
  if (!a || !b) throw new Error('版本不存在');
  if (a.target !== b.target || !a.target.startsWith('skills/')) throw new Error('A/B 评测需要同一个 skill 的两个版本');
  const cases = loadBenchmark(benchFile);
  if (!cases.length) throw new Error('评测基准集为空');
  const ra = await runVersion(hub, agent, a.content, cases, db);
  const rb = await runVersion(hub, agent, b.content, cases, db);
  const summary = {
    target: a.target, A: { version: versionA, passRate: ra.passRate, cacheHits: ra.cacheHits }, B: { version: versionB, passRate: rb.passRate, cacheHits: rb.cacheHits }, cases: ra.results.length,
    deterministic: { temperature: EVAL_TEMPERATURE, seed: EVAL_SEED, note: 'seed 仅在支持的服务商传入；同一 模型+提示词哈希+输入哈希 命中缓存直接复用' },
    at: new Date().toISOString(), note: ra.results.length < 5 ? '样本量少，结论仅供参考，标记为待验证' : '' };
  agent.setEvalResult(versionA, { ...summary, results: ra.results });
  agent.setEvalResult(versionB, { ...summary, results: rb.results });
  agent.appendImprovementLog(`A/B 评测 ${a.target}：#${versionA} 通过率 ${(ra.passRate * 100).toFixed(0)}% vs #${versionB} 通过率 ${(rb.passRate * 100).toFixed(0)}%${summary.note ? '（' + summary.note + '）' : ''}`);
  return { ...summary, resultsA: ra.results, resultsB: rb.results };
}
