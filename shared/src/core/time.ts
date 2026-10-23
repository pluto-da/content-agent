/**
 * 时间：统一按 Asia/Shanghai（UTC+8，无夏令时）解析与展示；相对日期由代码计算，不让模型算（6.12、U-time-*）。
 */
const OFFSET_MS = 8 * 3600 * 1000;
export const TZ = 'Asia/Shanghai';

/** 某个时刻在北京时间下的年月日时分。 */
export function shParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number; wd: number } {
  const t = new Date(d.getTime() + OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: t.getUTCDay() };
}
/** 北京时间的年月日时分 → 真实时刻。 */
export function fromSh(y: number, m: number, d: number, hh = 0, mm = 0): Date { return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS); }
export function shDate(d: Date): string { const p = shParts(d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
export function shDateTime(d: Date): string { const p = shParts(d); return `${shDate(d)} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`; }
export function shIso(d: Date): string { const p = shParts(d); return `${shDate(d)}T${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}:00+08:00`; }
const WD = ['日', '一', '二', '三', '四', '五', '六'];
export const weekdayZh = (d: Date): string => `周${WD[shParts(d).wd]}`;

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnToInt(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? CN_NUM[m[1]]! : 1) * 10 + (m[2] ? CN_NUM[m[2]]! : 0);
  return s.length === 1 && s in CN_NUM ? CN_NUM[s]! : null;
}

export interface ParsedWhen { at?: Date; rrule?: string; text: string }
/**
 * 解析常见中文时间：今天/明天/后天/大后天 + 早上/上午/中午/下午/晚上 + N点[半|N分]；下周一…；每周一 9 点；N 分钟/小时后。
 * 解析不出来返回 null（由 Agent 问一个问题，不猜）。
 */
/** 1.1.0：英文界面的常见写法先换成中文再解析（tomorrow 9 am / in 30 minutes / every Monday 10:00 / next Friday 3 pm）。 */
export function enWhenToZh(input: string): string {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let s = ` ${input.toLowerCase()} `;
  s = s.replace(/\bin\s+(\d+)\s*(?:minutes?|mins?)\b/g, '$1分钟后').replace(/\bin\s+(\d+)\s*(?:hours?|hrs?)\b/g, '$1小时后');
  s = s.replace(/\b(every|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, (_, k: string, d: string) => `${k === 'every' ? '每' : '下'}周${'日一二三四五六'[DAYS.indexOf(d)]}`);
  s = s.replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, (d: string) => `周${'日一二三四五六'[DAYS.indexOf(d)]}`);
  s = s.replace(/\btomorrow\b/g, '明天').replace(/\btoday\b/g, '今天').replace(/\btonight\b/g, '今晚');
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g, (_, h: string, m: string | undefined, ap: string) => `${ap === 'am' ? '上午' : '下午'}${h}点${m ? `${m}分` : ''}`);
  return s.trim();
}
export function parseWhenZh(input: string, now: Date): ParsedWhen | null {
  const s = (/[a-z]/i.test(input) ? enWhenToZh(input) : input).replace(/\s+/g, '');
  const rel = /(\d+|[一二两三四五六七八九十]+)(分钟|小时)(以?后)/.exec(s);
  if (rel) {
    const n = cnToInt(rel[1]!);
    if (n === null) return null;
    const at = new Date(now.getTime() + n * (rel[2] === '小时' ? 3600e3 : 60e3));
    return { at, text: shDateTime(at) };
  }
  const p = shParts(now);
  let dayOffset: number | null = null;
  let weekly: number | null = null;
  if (/大后天/.test(s)) dayOffset = 3; else if (/后天/.test(s)) dayOffset = 2; else if (/明天|明早|明晚|明儿/.test(s)) dayOffset = 1; else if (/今天|今晚|今早|今儿/.test(s)) dayOffset = 0;
  const wk = /(下下|下|这|本)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(s);
  const every = /每(?:周|星期|礼拜)([一二三四五六日天])/.exec(s);
  if (every) weekly = '日一二三四五六'.indexOf(every[1] === '天' ? '日' : every[1]!);
  else if (wk) {
    const target = '日一二三四五六'.indexOf(wk[2] === '天' ? '日' : wk[2]!);
    // 周一为一周起点：本周/这周 = 本周内；下周 = 下一周；无前缀 = 下一个该天（今天之后）
    const curIdx = (p.wd + 6) % 7; const tIdx = (target + 6) % 7;
    if (wk[1] === '下') dayOffset = 7 - curIdx + tIdx;
    else if (wk[1] === '下下') dayOffset = 14 - curIdx + tIdx;
    else if (wk[1] === '这' || wk[1] === '本') dayOffset = tIdx - curIdx;
    else dayOffset = ((tIdx - curIdx + 7) % 7) || 7;
  }
  const tm = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|明早|明晚|今晚|今早)?(\d{1,2}|[一二两三四五六七八九十]+)(?:点|:|：|时)(半|(\d{1,2}|[一二三四五六七八九十]+)分?)?/.exec(s);
  let hh = 9, mm = 0, hasTime = false;
  if (tm) {
    const h = cnToInt(tm[2]!);
    if (h === null || h > 24) return null;
    hh = h; hasTime = true;
    if (tm[3] === '半') mm = 30; else if (tm[4]) { const m2 = cnToInt(tm[4]); if (m2 === null || m2 > 59) return null; mm = m2; }
    const part = tm[1] ?? (/晚/.test(s) ? '晚上' : /下午/.test(s) ? '下午' : '');
    if ((part === '下午' || part === '傍晚' || part === '晚上' || part === '明晚' || part === '今晚') && hh < 12) hh += 12;
    if (part === '中午' && hh < 11) hh += 12;
  } else if (/早|上午/.test(s)) { hh = 9; hasTime = true; } else if (/晚/.test(s)) { hh = 20; hasTime = true; }
  if (weekly !== null) {
    const byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekly]!;
    return { rrule: `FREQ=WEEKLY;BYDAY=${byday};BYHOUR=${hh};BYMINUTE=${mm}`, text: `每周${WD[weekly]} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}（北京时间）` };
  }
  if (dayOffset === null && !hasTime) return null;
  const base = fromSh(p.y, p.m, p.d + (dayOffset ?? 0), hh, mm);
  let at = base;
  if (dayOffset === null && at.getTime() <= now.getTime()) at = fromSh(p.y, p.m, p.d + 1, hh, mm);
  return { at, text: `${shDate(at)}（${weekdayZh(at)}）${String(shParts(at).hh).padStart(2, '0')}:${String(shParts(at).mm).padStart(2, '0')}（北京时间）` };
}
/** rrule（本项目只用 WEEKLY 子集）下一次触发时刻。 */
export function nextWeekly(rrule: string, after: Date): Date | null {
  const m = /FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA);BYHOUR=(\d+);BYMINUTE=(\d+)/.exec(rrule);
  if (!m) return null;
  const target = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(m[1]!);
  const p = shParts(after);
  for (let i = 0; i < 8; i++) {
    const cand = fromSh(p.y, p.m, p.d + i, Number(m[2]), Number(m[3]));
    if (shParts(cand).wd === target && cand.getTime() > after.getTime()) return cand;
  }
  return null;
}
