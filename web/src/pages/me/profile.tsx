/** 我的 → 账号画像（0.8.0）：Agent 记忆。只服务用户本人一个账号；Agent 只能提议修改，用户点“采纳”才写入。 */
import { useEffect, useState } from 'react';
import { useStoreChange } from '../../local/useStore';
import { EMPTY_PROFILE, getProfile, saveProfile, type Profile } from '../../agent/store';
import { tr } from '../../i18n';

export function ProfilePage() {
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [msg, setMsg] = useState('');
  useEffect(() => { void getProfile().then(setP); }, []);
  useStoreChange(['kv:profile'], () => void getProfile().then(setP));
  const list = (s: string) => s.split(/[，,、\n]/).map((x) => x.trim()).filter(Boolean);
  return (
    <form className="page page-narrow flex flex-col gap-3" data-testid="profile-page" onSubmit={async (e) => { e.preventDefault(); await saveProfile(p); setMsg('已保存。Agent 每轮都会带上这份画像。'); }}>
      <label className="text-[13px] text-muted">{tr('ui.positioning_who_i_am_for')}<textarea rows={2} value={p.positioning} onChange={(e) => setP({ ...p, positioning: e.target.value })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">{tr('ui.audience_age_role_pain_points')}<textarea rows={2} value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">{tr('ui.style_tone_common_phrasing_emoji')}<textarea rows={2} value={p.style.tone} onChange={(e) => setP({ ...p, style: { ...p.style, tone: e.target.value } })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">{tr('ui.banned_words_comma_separated')}<input value={p.style.banned.join('，')} onChange={(e) => setP({ ...p, style: { ...p.style, banned: list(e.target.value) } })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">{tr('ui.red_lines_topics_and_expressions')}<textarea rows={2} value={p.redlines.join('，')} onChange={(e) => setP({ ...p, redlines: list(e.target.value) })} className="w-full !text-[15px]" /></label>
      {p.performance.length > 0 && <div className="text-[13px] text-muted">{tr('ui.past_performance_written_after_reviews')}<ul className="m-0 pl-5">{p.performance.map((x, i) => <li key={i}>{x.note}（{x.date}）</li>)}</ul></div>}
      <button type="submit" className="primary self-start">{tr('ui.save_profile')}</button>
      {msg && <p className="m-0 text-[13px] text-muted" role="status">{msg}</p>}
    </form>
  );
}
