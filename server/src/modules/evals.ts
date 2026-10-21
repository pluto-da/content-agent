import { existsSync, readFileSync } from 'node:fs';
import type { ModelHub } from '../models/hub.js';
import { extractJson } from '../models/util.js';
import { boundaryPreamble } from '../boundaries.js';
import { parseSkill } from '../skills/loader.js';
import type { AgentFiles } from './agentfiles.js';
import { checkCompliance } from './compliance.js';

export interface EvalCase {
  id: string;
  platform: string;
  topic: string;
  checks: { minLen?: number; maxLen?: number; mustInclude?: string[]; forbid?: string[]; requireTitle?: boolean; noComplianceWarn?: boolean };
}

export interface CaseResult { id: string; passed: boolean; failures: string[] }

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

async function runVersion(hub: ModelHub, agent: AgentFiles, skillSrc: string, cases: EvalCase[]): Promise<{ passRate: number; results: CaseResult[] }> {
  const skill = parseSkill(skillSrc, 'eval');
  const results: CaseResult[] = [];
  for (const c of cases.filter((x) => !skill.platform || x.platform === skill.platform)) {
    try {
      const r = await hub.chat('eval', [
        { role: 'system', content: [boundaryPreamble(), agent.read('soul.md'), skill.body].join('\n\n---\n\n') },
        { role: 'user', content: `[TASK:rewrite] [PLATFORM:${c.platform}]\n选题标题：${c.topic}\n请输出 JSON：{"title","body","tags"}` },
      ]);
      results.push(judge(c, extractJson<{ title?: string; body?: string }>(r.content)));
    } catch (e) {
      results.push({ id: c.id, passed: false, failures: [`调用失败：${e instanceof Error ? e.message : String(e)}`] });
    }
  }
  const passRate = results.length ? results.filter((r) => r.passed).length / results.length : 0;
  return { passRate, results };
}

/** A/B 评测：对同一 skill 的两个版本运行基准集，结果写入两个版本的 eval_result。 */
export async function abTest(hub: ModelHub, agent: AgentFiles, benchFile: string, versionA: number, versionB: number) {
  const a = agent.version(versionA);
  const b = agent.version(versionB);
  if (!a || !b) throw new Error('版本不存在');
  if (a.target !== b.target || !a.target.startsWith('skills/')) throw new Error('A/B 评测需要同一个 skill 的两个版本');
  const cases = loadBenchmark(benchFile);
  if (!cases.length) throw new Error('评测基准集为空');
  const ra = await runVersion(hub, agent, a.content, cases);
  const rb = await runVersion(hub, agent, b.content, cases);
  const summary = { target: a.target, A: { version: versionA, passRate: ra.passRate }, B: { version: versionB, passRate: rb.passRate }, cases: ra.results.length, at: new Date().toISOString(), note: ra.results.length < 5 ? '样本量少，结论仅供参考，标记为待验证' : '' };
  agent.setEvalResult(versionA, { ...summary, results: ra.results });
  agent.setEvalResult(versionB, { ...summary, results: rb.results });
  agent.appendImprovementLog(`A/B 评测 ${a.target}：#${versionA} 通过率 ${(ra.passRate * 100).toFixed(0)}% vs #${versionB} 通过率 ${(rb.passRate * 100).toFixed(0)}%${summary.note ? '（' + summary.note + '）' : ''}`);
  return { ...summary, resultsA: ra.results, resultsB: rb.results };
}
