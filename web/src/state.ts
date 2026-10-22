/** 首页“下一步”：按状态给出唯一最该做的一件事（单测覆盖 A10）。 */
export interface Snapshot { hasModel: boolean; hotCount: number; pending: number; approved: number; published: number; drafts: number }
export interface NextStep { id: 'connect' | 'review' | 'publish' | 'topics' | 'write' | 'results'; title: string; hint: string; action: string; to: string; icon: string }

export function nextStep(s: Snapshot): NextStep {
  if (!s.hasModel) return { id: 'connect', title: '先连接一个模型', hint: '填一个 Key，点“测试连接”，两三秒就好', action: '去连接', to: 'me/models', icon: 'cpu' };
  if (s.pending > 0) return { id: 'review', title: `有 ${s.pending} 篇待审核`, hint: '看一眼、改两句，点“通过”', action: '去审核', to: 'write/pending', icon: 'review' };
  if (s.approved > 0) return { id: 'publish', title: `有 ${s.approved} 篇待发布`, hint: '复制文案并打开平台 App，由你本人发布', action: '去发布', to: 'publish', icon: 'send' };
  if (s.hotCount > 0) return { id: 'topics', title: `有 ${s.hotCount} 条新热点，挑一条写吧`, hint: '每条热点都可以一键“用它写一篇”', action: '去找选题', to: 'topics', icon: 'hot' };
  if (s.published > 0 && s.drafts > 0) return { id: 'results', title: '记录一下发布效果', hint: '填阅读、点赞，下次写得更准', action: '去看效果', to: 'results', icon: 'analytics' };
  return { id: 'write', title: '还没有选题', hint: '读一读今天的热点，或在下面直接输入一个想法', action: '去找选题', to: 'topics', icon: 'hot' };
}

export type Theme = 'system' | 'light' | 'dark';
