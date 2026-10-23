/**
 * 0.11.0 行为评测判官（ROADMAP 0.11「行为评测判官」）：BQ-01–BQ-32 用真实快速模型（MiMo mimo-v2.6-flash，temperature 0，JSON 输出）打分。
 *
 * 四件事，分开计数、分开报告（evals/real/judge-v11.json + judge-sample-v11.md）：
 *  1. live：被测回复由真实模型在 App 同一份系统前缀下生成（不给工具，工具结果写在上下文里），判官按 rubric 判通过 / 不通过；
 *  2. 对照集：每条用例一条应判通过（good）、一条应判不通过（bad）的人写对照回复 → 判官与合成标注的一致率；
 *  3. 规则判官：有确定性规则的用例（字数、问句数、感叹号、表格、Key 格式……）与模型判官在 live 回复上的一致率；
 *  4. 重复一致性：抽 8 条 live 判决再判一次（temperature 0），看结论是否相同。
 *  人工抽检 20%：按用例编号哈希固定抽 7 条，写进 judge-sample-v11.md，留空“人工结论”栏，**由用户抽检**（本次执行者是 AI，不冒充人工）。
 *
 * 纯函数（judgeMessages / parseVerdict / agreement / sampleIds）供 evals/judge.test.ts 离线单测；真实调用只在直接运行时发生：
 *   MIMO_INJECTED=1 npx tsx evals/judge.ts            # 每次最多跑约 95 秒，结果按请求哈希缓存在 out/judge-v11/cache/，重复运行接着跑，直到输出“完成”
 *   npx tsx evals/judge.ts --report                    # 只用缓存出报告
 * 控费：缓存命中不再请求；JUDGE_BUDGET（元，默认 3）超出即停。
 */
import { JUDGE_CASES, type JudgeCase, type Turn } from './judge-cases.js';

export const JUDGE_MODEL = 'mimo-v2.6-flash';
export const JUDGE_SYSTEM = [
  '你是严格、公正的对话评测判官。你只根据给定的“评分标准”判断“被测回复”是否通过，不考虑文笔好坏，不脑补标准之外的要求。',
  '对话上下文里“（系统：…）”是工具或系统给助手的事实，助手看得到，用户看不到。',
  '只输出一个 JSON 对象：{"pass": true 或 false, "reason": "不超过 40 字的中文理由"}，不要输出其他任何内容。',
].join('\n');

export function judgeMessages(c: JudgeCase, answer: string): { role: 'system' | 'user'; content: string }[] {
  const ctx = [...c.turns, { role: 'user' as const, content: c.user }].map((t: Turn) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`).join('\n');
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: `【用例】${c.id} ${c.title}\n【评分标准】${c.rubric}\n【对话上下文】\n${ctx}\n【被测回复（助手对最后一句用户话的回答）】\n${answer}\n\n请判断被测回复是否满足评分标准，只输出 JSON。` },
  ];
}

export function parseVerdict(text: string): { pass: boolean; reason: string } | null {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { pass?: unknown; reason?: unknown };
    const p = typeof j.pass === 'boolean' ? j.pass : j.pass === 'true' ? true : j.pass === 'false' ? false : null;
    return p === null ? null : { pass: p, reason: String(j.reason ?? '').slice(0, 80) };
  } catch { return null; }
}

export function agreement(pairs: { a: boolean | null | undefined; b: boolean | null | undefined }[]): { n: number; agree: number; rate: number | null } {
  const ok = pairs.filter((p) => typeof p.a === 'boolean' && typeof p.b === 'boolean');
  const agree = ok.filter((p) => p.a === p.b).length;
  return { n: ok.length, agree, rate: ok.length ? Math.round((agree / ok.length) * 1000) / 1000 : null };
}

/** 20% 抽检：按 FNV-1a(编号) 排序取前 ceil(n×0.2) 条，结果固定、与判官结论无关。 */
export function sampleIds(ids: string[], ratio = 0.2): string[] {
  const h = (s: string) => { let x = 0x811c9dc5; for (const ch of s) { x ^= ch.codePointAt(0)!; x = Math.imul(x, 0x01000193) >>> 0; } return x; };
  return [...ids].sort((a, b) => h(a) - h(b)).slice(0, Math.ceil(ids.length * ratio)).sort();
}

export const AGENT_EVAL_NOTE = '\n\n## 本轮评测说明\n这是行为评测：本轮不提供工具，请只用文字直接回答用户最后一句话；上下文里“（系统：…）”是工具结果或系统事实。';

/* ---------------- 直接运行：真实调用 ---------------- */
async function main(): Promise<void> {
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const shared = await import('../shared/dist/index.js') as typeof import('../shared/src/index.js');
  // @ts-expect-error 纯 JS 模块
  const common = await import('../scripts/real-common.mjs') as { mimoEnv(): { injected: boolean; key: string; baseURL: string; proxy?: string; clean(s: string): string }; nodeTransport(p?: string): import('../shared/src/index.js').Transport; mimoState(m: Record<string, string>, b: string): { state: import('../shared/src/index.js').ModelsStateV3 } };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cacheDir = join(root, 'out', 'judge-v11', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const reportOnly = process.argv.includes('--report');
  const env = common.mimoEnv();
  if (!reportOnly && !env.key) { process.stderr.write('没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求。\n'); process.exit(2); }
  const budget = Number(process.env.JUDGE_BUDGET ?? 3);
  const { state } = common.mimoState({ chat: JUDGE_MODEL, fast: JUDGE_MODEL }, env.baseURL);
  const deps = { state, transport: common.nodeTransport(env.proxy), getKey: async () => env.key };
  const prefix = shared.assemblePrefix(shared.DEFAULT_FILES as Record<string, string>).text + AGENT_EVAL_NOTE;
  const started = Date.now();
  const deadline = started + Number(process.env.JUDGE_SLICE_MS ?? 95000);
  let spent = 0, calls = 0, cacheHits = 0, pending = 0;

  type Cached = { text: string; cost: number | null; ms: number; usage?: unknown; error?: string };
  async function cachedCall(role: 'chat' | 'fast', messages: { role: 'system' | 'user' | 'assistant'; content: string }[], o: { temperature?: number; json?: boolean; maxTokens: number }): Promise<Cached | null> {
    const k = createHash('sha256').update(JSON.stringify({ role, model: JUDGE_MODEL, messages, o })).digest('hex').slice(0, 24);
    const f = join(cacheDir, `${k}.json`);
    if (existsSync(f)) { cacheHits++; return JSON.parse(readFileSync(f, 'utf8')) as Cached; }
    if (reportOnly || Date.now() > deadline || spent > budget) { pending++; return null; }
    const r = await shared.callRole(role, { role, messages, maxTokens: o.maxTokens, thinking: false, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.json ? { json: true } : {}) }, deps, { noFallback: true, retry: { max: 1, baseMs: 1500 } });
    calls++;
    const out: Cached = r.ok && r.value.type === 'text' ? { text: r.value.text, cost: r.cost, ms: r.ms, usage: r.usage } : { text: '', cost: 0, ms: r.ms, error: r.ok ? 'not text' : env.clean(`${r.error.kind}: ${r.error.reason}`) };
    spent += out.cost ?? 0;
    if (!out.error) writeFileSync(f, JSON.stringify(out));
    return out;
  }
  const pool = async <T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> => { const res: R[] = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]!); } })); return res; };

  // 1. 被测回复（真实模型、App 系统前缀）
  const answers = await pool(JUDGE_CASES, 6, (c) => cachedCall('chat', [{ role: 'system', content: prefix }, ...c.turns, { role: 'user', content: c.user }], { maxTokens: 700 }));
  const judge = (c: JudgeCase, a: string) => cachedCall('fast', judgeMessages(c, a), { temperature: 0, json: true, maxTokens: 200 });
  // 2. 判官：live / 对照 good / 对照 bad
  const live = await pool(JUDGE_CASES, 6, async (c) => { const a = answers[JUDGE_CASES.indexOf(c)]; return a && !a.error ? judge(c, a.text) : null; });
  const goods = await pool(JUDGE_CASES, 6, (c) => judge(c, c.good));
  const bads = await pool(JUDGE_CASES, 6, (c) => judge(c, c.bad));
  // 4. 重复一致性：前 8 条 live 再判一次（不同缓存键：在 messages 里加一个空的重复标记）
  const rep = JUDGE_CASES.slice(0, 8);
  const repeats = await pool(rep, 4, async (c) => { const a = answers[JUDGE_CASES.indexOf(c)]; if (!a || a.error) return null; const m = judgeMessages(c, a.text); m[1] = { ...m[1]!, content: `${m[1]!.content}\n（复核）` }; return cachedCall('fast', m, { temperature: 0, json: true, maxTokens: 200 }); });

  const rows = JUDGE_CASES.map((c, i) => {
    const ans = answers[i]?.text ?? null;
    const v = live[i] ? parseVerdict(live[i]!.text) : null;
    const g = goods[i] ? parseVerdict(goods[i]!.text) : null;
    const b = bads[i] ? parseVerdict(bads[i]!.text) : null;
    const rule = ans != null && c.rule ? c.rule(ans) : null;
    return { id: c.id, title: c.title, answer: ans, liveVerdict: v, ruleVerdict: rule, goodVerdict: g, badVerdict: b };
  });
  const ctrl = agreement([...rows.map((r) => ({ a: r.goodVerdict?.pass, b: true })), ...rows.map((r) => ({ a: r.badVerdict?.pass, b: false }))]);
  const ruleAgree = agreement(rows.filter((r) => r.ruleVerdict !== null).map((r) => ({ a: r.liveVerdict?.pass, b: r.ruleVerdict })));
  const repeatAgree = agreement(rep.map((c, k) => ({ a: rows[JUDGE_CASES.indexOf(c)]!.liveVerdict?.pass, b: repeats[k] ? parseVerdict(repeats[k]!.text)?.pass : null })));
  const livePass = rows.filter((r) => r.liveVerdict?.pass === true).length, liveFail = rows.filter((r) => r.liveVerdict?.pass === false).length;
  const sample = sampleIds(JUDGE_CASES.map((c) => c.id));
  const done = pending === 0 && rows.every((r) => r.answer != null && r.liveVerdict && r.goodVerdict && r.badVerdict);
  const allCached = [...answers, ...live, ...goods, ...bads, ...repeats].filter(Boolean) as Cached[];
  const costAll = allCached.reduce((s, x) => s + (x.cost ?? 0), 0);
  const report = {
    version: '0.11.0', at: new Date().toISOString(), judgeModel: JUDGE_MODEL, judgeTemperature: 0, generatorModel: JUDGE_MODEL, generatorSystem: 'assemblePrefix(DEFAULT_FILES)（App 默认 VFS 系统前缀）+ 评测说明（不给工具）',
    complete: done, pending,
    live: { judged: livePass + liveFail, pass: livePass, fail: liveFail, failed: rows.filter((r) => r.liveVerdict?.pass === false).map((r) => ({ id: r.id, reason: r.liveVerdict!.reason })) },
    agreement: {
      controlSet: { ...ctrl, note: '判官 vs 合成标注（每条 1 good 应通过 + 1 bad 应不通过，人写的对照回复）' },
      ruleJudge: { ...ruleAgree, note: '模型判官 vs 规则判官（只统计有确定性规则的用例），在 live 回复上' },
      repeat: { ...repeatAgree, note: '同一 live 回复再判一次（temperature 0）' },
      human: { sampleIds: sample, status: '待用户抽检', note: '人工抽检 20%（7 条）见 evals/real/judge-sample-v11.md；本次执行者是 AI，未冒充人工，一致率待用户填写后计算' },
    },
    cost: { yuanThisRun: Math.round(spent * 1e6) / 1e6, yuanAllCached: Math.round(costAll * 1e6) / 1e6, calls, cacheHits, budgetYuan: budget },
    rows,
  };
  const text = JSON.stringify(report, null, 2);
  if (shared.findSecrets(text).length) throw new Error('报告疑似含密钥，未写盘');
  const outDir = join(root, 'evals', 'real');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'judge-v11.json'), text);
  writeFileSync(join(root, 'out', 'judge-v11', 'judge-v11.json'), text);
  const md = [
    '# 行为评测判官 · 人工抽检表（0.11.0）', '',
    `抽检 20%：${sample.length} / ${JUDGE_CASES.length} 条（按编号哈希固定抽取，与判官结论无关）。判官：${JUDGE_MODEL}，temperature 0。`, '',
    '**由谁做：用户本人（待用户抽检）。** 请在每条“人工结论”填 通过 / 不通过，全部填完后把这份文件发回，即可算出判官与人工的一致率（目标 ≥ 90%）。', '',
    ...sample.flatMap((id) => { const r = rows.find((x) => x.id === id)!; const c = JUDGE_CASES.find((x) => x.id === id)!; return [`## ${id} ${c.title}`, '', `- 评分标准：${c.rubric}`, `- 用户最后一句：${c.user.replace(/\n+/g, ' ')}`, '- 被测回复：', '', '```', (r.answer ?? '（未生成）').trim(), '```', '', `- 判官结论：${r.liveVerdict ? (r.liveVerdict.pass ? '通过' : '不通过') : '（未判）'}（${r.liveVerdict?.reason ?? ''}）`, '- 人工结论：＿＿＿＿（通过 / 不通过）', '']; }),
  ].join('\n');
  writeFileSync(join(outDir, 'judge-sample-v11.md'), md);
  process.stdout.write(`${done ? '完成' : `未完成（还差 ${pending} 次调用，再运行一次接着跑）`}：live 通过 ${livePass} / 不通过 ${liveFail}；对照一致率 ${ctrl.rate}（${ctrl.agree}/${ctrl.n}）；规则一致率 ${ruleAgree.rate}（${ruleAgree.agree}/${ruleAgree.n}）；重复一致 ${repeatAgree.rate}（${repeatAgree.agree}/${repeatAgree.n}）；本次 ¥${report.cost.yuanThisRun}，累计 ¥${report.cost.yuanAllCached}，请求 ${calls}，缓存 ${cacheHits}\n`);
}

const isMain = typeof process !== 'undefined' && process.argv[1] && /judge\.ts$/.test(process.argv[1]);
if (isMain) main().catch((e) => { process.stderr.write(`${(e as Error)?.stack ?? e}\n`); process.exit(1); });
