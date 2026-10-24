/**
 * 1.4.0 上市公司模式状态（config/listed.json，唯一真相源）。默认关闭；启用要求先启用 1.3 集团模式；可随时退回（关开关，数据保留）。
 * clock：walkthrough / 自检用的 mock 时钟（ISO）；正常使用为空，按真实时间。
 */
import { defaultBoard, type Board, type Motion, type BoardMeeting, type Agm } from './board.js';
import type { GovSpend } from './gov.js';
import type { Budget, MonthlyReview } from './operations.js';
import type { StrategyPlan } from './strategy.js';
import type { Nomination, Assessment, Succession } from './talent.js';
import type { CaseCard, Training } from './university.js';
import type { WeeklyLesson } from './academy.js';
import type { PeriodicReport, EarningsCall, ChairmanBrief } from './disclosure.js';
import { defaultRisks, type Risk, type AuditReport, type ControlResult } from './oversight.js';

export interface SimData {
  spend: { ref: string; yuan: number; at: string; deptId: string; vendor?: string; model?: string }[]; usage: { ref: string; yuan: number; at: string }[];
  drafts: { id: string; deptId: string; status: 'pending' | 'approved' | 'published' | 'rejected'; at: string; text: string; sources: string[] }[];
  metrics: { key: string; label: string; dim: 'outcome' | 'audience' | 'process' | 'growth'; target: number | null; value: number | null; unit: string; ref: string | null; direction: 'up' | 'down' }[];
  actions: { id: string; matter: string; role: 'executor' | 'dept_head' | 'ceo' | 'chairman'; actorId: string; amountYuan?: number; summary: string; approvedBy?: 'chairman' | 'ceo' | null; at: string; deptId?: string }[];
  rulings: { id: string; kind: 'return' | 'veto'; clause: string; by: string; at: string }[];
  hits: { id: string; title: string; metric: string; why: string; platform: string }[];
}
export interface ListedState {
  version: 1; enabled: boolean; enabledAt: string | null; onboarded: boolean; clock: string | null; sim: boolean;
  board: Board; motions: Motion[]; boardMeetings: BoardMeeting[]; agms: Agm[];
  govLedger: GovSpend[]; govCapShare: number; monthBudgetYuan: number | null;
  /** 本机用量日志（每次治理模型调用一条，ref 与 govLedger 对应），供内审对账。 */ usageLog: { ref: string; yuan: number; at: string; model?: string }[];
  /** 模拟数据（只在演示 / 自检时生成，单独存放、报告标“含模拟数据”，不写入你的草稿与数据）。 */ simData: SimData | null;
  deliveries: { to: string; kind: 'to' | 'cc'; title: string; ref: string; at: string }[];
  budget: Budget | null; reviews: MonthlyReview[];
  reports: PeriodicReport[]; calls: EarningsCall[]; brief: ChairmanBrief | null; briefPeriod: 'daily' | 'weekly';
  strategies: StrategyPlan[]; nominations: Nomination[]; assessments: Assessment[]; successions: Succession[];
  academy: { read: string[]; weeklyOff: boolean; lessons: WeeklyLesson[] };
  cases: CaseCard[]; trainings: Training[]; bestPractices: { quarter: string; caseIds: string[]; skillPaths: string[] }[];
  risks: Risk[]; audits: AuditReport[]; controls: { at: string; results: ControlResult[]; text: string } | null;
}
export function emptyListedState(): ListedState {
  return { version: 1, enabled: false, enabledAt: null, onboarded: false, clock: null, sim: false, board: defaultBoard(), motions: [], boardMeetings: [], agms: [], govLedger: [], govCapShare: 0.15, monthBudgetYuan: null, usageLog: [], simData: null, deliveries: [], strategies: [], nominations: [], assessments: [], successions: [], academy: { read: [], weeklyOff: false, lessons: [] }, cases: [], trainings: [], bestPractices: [], budget: null, reviews: [], reports: [], calls: [], brief: null, briefPeriod: 'weekly', risks: defaultRisks('2026-01-01T00:00:00.000Z'), audits: [], controls: null };
}
export function readListedState(raw: string | null | undefined): ListedState {
  const base = emptyListedState();
  if (!raw) return base;
  try { const j = JSON.parse(raw) as Partial<ListedState>; return { ...base, ...j, board: j.board ?? base.board, academy: { ...base.academy, ...(j.academy ?? {}) } }; } catch { return base; }
}
export function writeListedState(s: ListedState): string {
  return JSON.stringify({ ...s, motions: s.motions.slice(-200), audits: s.audits.slice(-24), reviews: s.reviews.slice(-36), reports: s.reports.slice(-20), cases: s.cases.slice(-500), calls: s.calls.slice(-20), govLedger: s.govLedger.slice(-3000), usageLog: s.usageLog.slice(-3000), deliveries: s.deliveries.slice(-200) });
}
