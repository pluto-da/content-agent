/** 我的 → 账号画像（0.8.0）：Agent 记忆。只服务用户本人一个账号；Agent 只能提议修改，用户点“采纳”才写入。 */
import { useEffect, useState } from 'react';
import { useStoreChange } from '../../local/useStore';
import { EMPTY_PROFILE, getProfile, saveProfile, type Profile } from '../../agent/store';

export function ProfilePage() {
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [msg, setMsg] = useState('');
  useEffect(() => { void getProfile().then(setP); }, []);
  useStoreChange(['kv:profile'], () => void getProfile().then(setP));
  const list = (s: string) => s.split(/[，,、\n]/).map((x) => x.trim()).filter(Boolean);
  return (
    <form className="page page-narrow flex flex-col gap-3" data-testid="profile-page" onSubmit={async (e) => { e.preventDefault(); await saveProfile(p); setMsg('已保存。Agent 每轮都会带上这份画像。'); }}>
      <label className="text-[13px] text-muted">定位（我是谁、为谁、提供什么）<textarea rows={2} value={p.positioning} onChange={(e) => setP({ ...p, positioning: e.target.value })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">受众（年龄段、身份、痛点、在哪些平台）<textarea rows={2} value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">风格（语气、常用句式、表情使用）<textarea rows={2} value={p.style.tone} onChange={(e) => setP({ ...p, style: { ...p.style, tone: e.target.value } })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">禁用词（逗号分隔）<input value={p.style.banned.join('，')} onChange={(e) => setP({ ...p, style: { ...p.style, banned: list(e.target.value) } })} className="w-full !text-[15px]" /></label>
      <label className="text-[13px] text-muted">偏好红线：不碰的话题、不接受的表达（逗号分隔；发布前检查会逐条核对）<textarea rows={2} value={p.redlines.join('，')} onChange={(e) => setP({ ...p, redlines: list(e.target.value) })} className="w-full !text-[15px]" /></label>
      {p.performance.length > 0 && <div className="text-[13px] text-muted">历史表现（复盘后经你采纳写入）：<ul className="m-0 pl-5">{p.performance.map((x, i) => <li key={i}>{x.note}（{x.date}）</li>)}</ul></div>}
      <button type="submit" className="primary self-start">保存画像</button>
      {msg && <p className="m-0 text-[13px] text-muted" role="status">{msg}</p>}
    </form>
  );
}
