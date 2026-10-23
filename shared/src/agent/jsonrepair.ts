/**
 * 模型 JSON 修复链（6.17 U-json-*）：去代码块 / 前后说明 → 去尾逗号 → 单引号键 → 截断补全括号 → 解析；仍失败交给调用方“带错误修复 1 次 → 降级”。
 */
export function repairJson(text: string): { ok: true; value: unknown; repaired: string[] } | { ok: false; error: string } {
  const repaired: string[] = [];
  let s = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)(```|$)/.exec(s);
  if (fenced) { s = fenced[1]!.trim(); repaired.push('去代码块'); }
  const start = s.search(/[[{]/);
  if (start < 0) return { ok: false, error: '没有 JSON' };
  if (start > 0) { s = s.slice(start); repaired.push('去前置说明'); }
  try { return { ok: true, value: JSON.parse(s), repaired }; } catch { /* continue */ }
  // 截掉结尾多余说明：找到最后一个可能的闭合位置
  const tryParse = (x: string) => { try { return { ok: true as const, value: JSON.parse(x) }; } catch (e) { return { ok: false as const, e }; } };
  let t = s.replace(/,\s*([}\]])/g, '$1');
  if (t !== s) repaired.push('去尾逗号');
  t = t.replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":');
  let r = tryParse(t);
  if (r.ok) return { ok: true, value: r.value, repaired };
  // 截断补全：按栈补齐未闭合的字符串、括号
  const stack: string[] = []; let inStr = false; let esc = false; let lastGood = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) { lastGood = i + 1; break; } }
  }
  if (lastGood) { r = tryParse(t.slice(0, lastGood)); if (r.ok) { repaired.push('去结尾说明'); return { ok: true, value: r.value, repaired }; } }
  let u = t; if (inStr) u += '"';
  u = u.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  u += stack.reverse().join('');
  r = tryParse(u.replace(/,\s*([}\]])/g, '$1'));
  if (r.ok) { repaired.push('截断补全'); return { ok: true, value: r.value, repaired }; }
  return { ok: false, error: (r as { e: Error }).e?.message ?? '无法解析' };
}
