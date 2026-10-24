import { describe, it, expect } from 'vitest';
import {
  defaultBoard, validateBoard, pickIndependentModels, independenceOf, INDEPENDENCE_TEXT, isWeak, newMotion, secretaryMaterials, castVote, chairmanDecide, overrideNotice, parseVote,
  directorPrompt, independentVotes, mockDirector, boardMinutes, newAgm, agmStep, closeAgm, AGM_STEPS, regularDue, checkGovResolution, governanceGrants, govCostStatus, canSpendGov,
  scrubPrivate, privacyLeaks, PEN_NAME, LISTED_HONESTY, emptyListedState, readListedState, writeListedState, type ModelRef, type GovSpeaker,
} from '../src/index.js';

const MIMO_PRO: ModelRef = { vendor: 'mimo', model: 'mimo-v2.6-pro' };
const MIMO_FLASH: ModelRef = { vendor: 'mimo', model: 'mimo-v2.6-flash' };
const DS: ModelRef = { vendor: 'deepseek', model: 'deepseek-chat' };
const AT = '2026-10-24T08:00:00.000Z';

describe('G1 股东会（年度大会）流程完整', () => {
  it('四步按顺序：审议年报 → 使命愿景目标 → 预算总额 → 章程修改；缺一步不能闭会；章程修改触碰硬边界被拒', () => {
    let a = newAgm(2026, 'manual', AT);
    expect(AGM_STEPS).toEqual(['审议年报', '确定下一年度的使命、愿景和目标', '确定集团预算总额', '批准章程修改']);
    expect(() => agmStep(a, '确定集团预算总额', '¥120')).toThrow(/请先完成/);
    a = agmStep(a, '审议年报', '年报 2026 已审议');
    a = agmStep(a, '确定下一年度的使命、愿景和目标', '使命：做有用的内容');
    a = agmStep(a, '确定集团预算总额', '¥120 / 年');
    expect(() => closeAgm(a)).toThrow(/批准章程修改/);
    expect(() => agmStep(a, '批准章程修改', '章程第 3 条：允许 CEO 自动发布到抖音')).toThrow(/硬边界/);
    a = agmStep(a, '批准章程修改', '本年度不修改章程');
    expect(closeAgm(a).status).toBe('closed');
  });
});

describe('G2 董事会组成、独立性规则、议事规则、表决理由、董事长否决留痕', () => {
  it('默认 2 名独立董事；不同服务商 = 独立性强；只有 MiMo = 另一个 MiMo 模型并标“独立性弱”；只有一个模型 = 同模型跑两遍', () => {
    expect(pickIndependentModels([MIMO_PRO, DS], MIMO_PRO).map((p) => p.independence)).toEqual(['strong', 'strong']);
    const onlyMimo = pickIndependentModels([MIMO_PRO, MIMO_FLASH], MIMO_PRO);
    expect(onlyMimo.every((p) => p.model?.model === 'mimo-v2.6-flash' && p.independence === 'weak_model')).toBe(true);
    expect(INDEPENDENCE_TEXT.weak_model).toMatch(/独立性弱/);
    const single = defaultBoard({ ceo: MIMO_PRO, available: [MIMO_PRO] });
    const ids = single.directors.filter((d) => d.kind === 'independent');
    expect(ids.every((d) => d.independence === 'weak_single' && d.runs === 2 && (d.temperature ?? 0) > 0.6)).toBe(true);
    expect(validateBoard(single).ok).toBe(true);
    expect(validateBoard(single).warnings.join()).toMatch(/独立性弱/);
    const b = defaultBoard({ ceo: MIMO_PRO, available: [MIMO_PRO, MIMO_FLASH, DS] });
    for (const d of b.directors.filter((x) => x.kind === 'independent')) { expect(d.model?.model).not.toBe(MIMO_PRO.model); expect(isWeak(independenceOf(d, MIMO_PRO))).toBe(false); }
    expect(b.directors.map((d) => d.kind)).toEqual(['chairman', 'executive', 'independent', 'independent', 'secretary']);
  });
  it('独立董事只读原始记录，不读 CEO 总结；表决须写理由；董事长否决独立董事意见被记录（不阻拦）', async () => {
    const b = defaultBoard({ ceo: MIMO_PRO, available: [MIMO_PRO, MIMO_FLASH] });
    const mats = secretaryMaterials({ title: 'Q4 追加预算', conclusion: '建议追加 ¥20', background: '短视频事业部本季超支', data: [{ label: '本季花费 ¥38', ref: 'ledger#q4' }], risks: ['超支 20% 以上'], ask: '是否追加' });
    expect(mats.split('\n')[0]).toMatch(/^【结论】/);
    let { motion } = newMotion([], { title: 'Q4 追加预算 ¥20', matter: 'budget_adjust', materials: mats, evidence: [{ label: '本季花费', ref: 'ledger#q4' }], at: AT });
    const ceoSummary = 'CEO 致辞：一切都很好，请批准';
    const p = directorPrompt(b.directors[2]!, motion, [{ kind: '花费账', ref: 'ledger#q4', text: '短视频事业部 Q4 超支 25%' }]);
    expect(p.user).not.toContain(ceoSummary);
    expect(p.user).toContain('[R1] 花费账·ledger#q4');
    expect(p.system).toMatch(/第一句只能是“同意”“反对”或“弃权”/);
    expect(() => castVote(motion, { directorId: 'id-1', choice: 'oppose', reason: '不行' }, b)).toThrow(/理由/);
    expect(() => chairmanDecide(motion, b, true)).toThrow(/未表态/);
    motion = await independentVotes(motion, b, [{ kind: '花费账', ref: 'ledger#q4', text: '短视频事业部 Q4 超支 25%' }], mockDirector);
    expect(motion.votes.filter((v) => v.choice === 'oppose')).toHaveLength(2);
    expect(motion.votes.every((v) => v.reason.length >= 8)).toBe(true);
    const decided = chairmanDecide(motion, b, true, '', AT);
    expect(decided.decision).toBe('approved');
    expect(decided.override?.against).toEqual(['id-1', 'id-2']);
    expect(overrideNotice(decided, b)).toMatch(/用来提醒，不阻拦/);
    expect(boardMinutes('董事会〔2026〕001号', [decided], b)).toMatch(/反对.*董事长：批准.*已记录在案/s);
  });
  it('表态解析；单模型跑两遍取更审慎的一票；例会每季度一次', async () => {
    expect(parseVote('反对。理由：没有数据')).toEqual({ choice: 'oppose', reason: '没有数据' });
    expect(parseVote('同意，记录一致').choice).toBe('agree');
    expect(parseVote('我觉得可以').choice).toBeNull();
    const b = defaultBoard({ ceo: MIMO_PRO, available: [MIMO_PRO] });
    let n = 0;
    const flaky: GovSpeaker = async () => ({ text: n++ % 2 === 0 ? '同意。理由：记录与数字一致，花费在预算内。' : '弃权。理由：样本太少，无法判断效果。', cost: 0.001 });
    const { motion } = newMotion([], { title: '年度战略', matter: 'strategy', materials: '【结论】按基准情景执行', at: AT });
    const m = await independentVotes(motion, b, [{ kind: '产出', ref: 'drafts', text: '本月 12 篇' }], flaky);
    expect(m.votes.every((v) => v.runs === 2 && v.choice === 'abstain')).toBe(true);
    expect(regularDue([], '2026Q4')).toBe(true);
    expect(regularDue([{ id: 'x', no: 'n', kind: 'regular', quarter: '2026Q4', motions: [], minutes: '', at: AT, spent: 0 }], '2026Q4')).toBe(false);
  });
});

describe('G3 战略、审计、提名与薪酬三个专门委员会，独立董事过半数', () => {
  it('三个委员会；每个委员会独立董事过半数；审计委员会主席为独立董事；1 名独立董事也合规；违规能查出', () => {
    for (const n of [1, 2, 3]) {
      const b = defaultBoard({ ceo: MIMO_PRO, available: [MIMO_PRO, DS], independents: n });
      expect(b.committees.map((c) => c.id)).toEqual(['strategy', 'audit', 'nomcomp']);
      const v = validateBoard(b); expect(v.errors).toEqual([]);
      const audit = b.committees.find((c) => c.id === 'audit')!;
      expect(b.directors.find((d) => d.id === audit.chair)?.kind).toBe('independent');
    }
    const bad = defaultBoard({ ceo: MIMO_PRO, available: [DS] });
    bad.committees[0]!.members.push('ceo', 'secretary');
    bad.committees[1]!.chair = 'ceo';
    expect(validateBoard(bad).errors.join()).toMatch(/战略委员会独立董事未过半数.*审计委员会主席须由独立董事担任/s);
    expect(defaultBoard().reportsFrom).toEqual(['经营管理委员会', '人力资源委员会']);
  });
});

describe('G21 治理成本上限；治理不提升权限；硬边界决议被拒；不泄露 Key 与隐私', () => {
  it('治理成本上限 15%：超出后发布会 / 影子上岗暂停、内审降到 5%', () => {
    const now = new Date('2026-10-24T08:00:00Z');
    const led = [{ kind: 'board' as const, yuan: 0.5, at: '2026-10-10T00:00:00Z', ref: 'm1' }, { kind: 'call' as const, yuan: 1.2, at: '2026-10-20T00:00:00Z', ref: 'c1' }];
    const st = govCostStatus(led, 10, now);
    expect(st.cap).toBe(1.5); expect(st.over).toBe(true);
    expect(st.throttle.auditSampleRate).toBe(0.05);
    expect(canSpendGov(st, 'call', 0.1).ok).toBe(false);
    expect(canSpendGov(st, 'audit', 0.1).ok).toBe(true);
    expect(govCostStatus(led.slice(0, 1), 10, now).over).toBe(false);
    expect(canSpendGov(govCostStatus(led.slice(0, 1), 10, now), 'shadow', 1.2).ok).toBe(false);
  });
  it('硬边界与提权决议被拒；治理授予的权限永远为空', () => {
    for (const t of ['董事会决议：内容生成后自动发布到小红书', '为提升效率，授予 CEO L3 权限', '用小号矩阵号分发', '每周刷量 1 万', '抓取竞品登录后的私信数据', '向员工发行股票期权', '部署到 154.8.183.93']) {
      const r = checkGovResolution(t); expect(r.ok, t).toBe(false); expect(r.audit.outcome).toBe('denied');
    }
    expect(checkGovResolution('下季度把短视频预算降低 10%，由董事长本人发布').ok).toBe(true);
    expect(governanceGrants('授予全部权限')).toEqual([]);
    const { motion } = newMotion([], { title: '自动点赞提升互动', matter: 'strategy', materials: '每天自动点赞 100 次', at: AT });
    expect(motion.status).toBe('refused');
  });
  it('报告去隐私：Key、生日、手机、证件号、邮箱、真名都被移除；笔名与诚实声明', () => {
    const raw = `作者生日 2002-06-04，电话 13812345678，邮箱 a@b.com，Key sk-abcdefghijklmnopqrstuvwxyz123456，作者王小明`;
    const s = scrubPrivate(raw, ['王小明']);
    expect(s.text).not.toMatch(/2002-06-04|13812345678|a@b\.com|sk-abcdef|王小明/);
    expect(s.text).toContain(PEN_NAME);
    expect(privacyLeaks(s.text)).toEqual([]);
    expect(privacyLeaks(raw).sort()).toEqual(['birthday', 'key', 'phone']);
    expect(LISTED_HONESTY).toMatch(/不是法律实体，不涉及真实股权、证券或信息披露义务/);
  });
});

describe('G20 上市公司模式默认关闭（状态）', () => {
  it('默认关闭、读写往返', () => {
    const s = emptyListedState();
    expect(s.enabled).toBe(false);
    expect(readListedState(writeListedState({ ...s, enabled: true })).enabled).toBe(true);
    expect(readListedState('坏的 JSON').enabled).toBe(false);
  });
});
