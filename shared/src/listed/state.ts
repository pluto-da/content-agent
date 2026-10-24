/**
 * 1.4.0 上市公司模式状态（config/listed.json，唯一真相源）。默认关闭；启用要求先启用 1.3 集团模式；可随时退回（关开关，数据保留）。
 * clock：walkthrough / 自检用的 mock 时钟（ISO）；正常使用为空，按真实时间。
 */
import { defaultBoard, type Board, type Motion, type BoardMeeting, type Agm } from './board.js';
import type { GovSpend } from './gov.js';
import type { Budget, MonthlyReview } from './operations.js';
import type { StrategyPlan } from './strategy.js';
import type { Nomination, Assessment, Succession } from './talent.js';
import type { PeriodicReport, EarningsCall, ChairmanBrief } from './disclosure.js';
import { defaultRisks, type Risk, type AuditReport, type ControlResult } from './oversight.js';

export interface ListedState {
  version: 1; enabled: boolean; enabledAt: string | null; onboarded: boolean; clock: string | null; sim: boolean;
  board: Board; motions: Motion[]; boardMeetings: BoardMeeting[]; agms: Agm[];
  govLedger: GovSpend[]; govCapShare: number; monthBudgetYuan: number | null;
  budget: Budget | null; reviews: MonthlyReview[];
  reports: PeriodicReport[]; calls: EarningsCall[]; brief: ChairmanBrief | null; briefPeriod: 'daily' | 'weekly';
  strategies: StrategyPlan[]; nominations: Nomination[]; assessments: Assessment[]; successions: Succession[];
  risks: Risk[]; audits: AuditReport[]; controls: { at: string; results: ControlResult[]; text: string } | null;
}
export function emptyListedState(): ListedState {
  return { version: 1, enabled: false, enabledAt: null, onboarded: false, clock: null, sim: false, board: defaultBoard(), motions: [], boardMeetings: [], agms: [], govLedger: [], govCapShare: 0.15, monthBudgetYuan: null, strategies: [], nominations: [], assessments: [], successions: [], budget: null, reviews: [], reports: [], calls: [], brief: null, briefPeriod: 'weekly', risks: defaultRisks('2026-01-01T00:00:00.000Z'), audits: [], controls: null };
}
export function readListedState(raw: string | null | undefined): ListedState {
  const base = emptyListedState();
  if (!raw) return base;
  try { const j = JSON.parse(raw) as Partial<ListedState>; return { ...base, ...j, board: j.board ?? base.board }; } catch { return base; }
}
export function writeListedState(s: ListedState): string {
  return JSON.stringify({ ...s, motions: s.motions.slice(-200), audits: s.audits.slice(-24), reviews: s.reviews.slice(-36), reports: s.reports.slice(-20), calls: s.calls.slice(-20), govLedger: s.govLedger.slice(-3000) });
}
