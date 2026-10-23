/**
 * 文案集中（ADR-007）：0.9.0 新增的核心层白话（错误、Agent 固定句、卡片按钮）集中在此，按消息 id 取用，便于将来多语言。
 * 规则：zh-CN 是完整的源语言；其他语言缺失的 id 回退到 zh-CN（不会显示 id 本身）；插值 {name}。
 * UI 层旧文案沿用 web/src/i18n.ts（以中文原文为键的英文表），两者并存，见 ADR-007。
 */
export type Locale = 'zh-CN' | 'en';
type Catalog = Record<string, string>;

export const ZH: Catalog = {
  'err.key_invalid': '{vendor}的 Key 不对（{status}），这一步没做成。',
  'err.key_invalid.advice': '到服务商后台重新复制 API Key（不要带空格），再点“测试”。',
  'err.quota': '{vendor}余额不足，这一步没做成。',
  'err.quota.advice': '到服务商后台充值，或换一家。',
  'err.rate_limited': '请求太频繁，服务商限流了。',
  'err.rate_limited.advice': '等一会儿会自动重试；也可以稍后再点重试。',
  'err.model_not_found': '模型名「{model}」在这家服务里不存在。请核对拼写（大小写、点、横杠、斜杠），或点「获取列表」直接选。',
  'err.model_not_enabled': '这个模型名存在，但你的账号还没开通它。去服务商控制台开通后再测。',
  'err.capability_mismatch': '「{model}」好像不支持“{role}”。检查这个模型名勾选的能力是否正确。',
  'err.content_filtered': '这条内容被服务商的内容审核拦了，我换个说法再试？',
  'err.network_offline': '网络断了，我停在第 {step} 步。网络恢复后点继续。',
  'err.cors': '这家服务不允许网页直接调用，请用 App 或连接服务器。',
  'err.timeout': '等太久没有返回，已停下。',
  'err.server': '服务商暂时出错（{status}），稍后再试。',
  'err.format': '返回的结构不对，可能地址指向了网页而不是接口。',
  'err.job_timeout': '视频 {minutes} 分钟还没生成完，任务还在服务商那边，我会在你下次打开时再查一次。',
  'err.result_expired': '结果链接已过期（服务商只保留 {hours} 小时），需要重新生成。',
  'err.size_unsupported': '这个模型不支持所选尺寸。',
  'err.audio_too_long': '音频超过模型上限（{limit}），先切分再转写。',
  'err.text_too_long': '文字超过模型单次上限（{limit} 字），我会自动分段。',
  'err.role_not_configured': '还没接{roleName}模型。',
  'err.unknown': '没做成：{detail}',
  'agent.not_configured.text_done': '还没接{roleName}模型，文字我先写好了，{roleName}等你接上再出。',
  'agent.stopped': '已停止。已完成的内容都保存了。',
  'agent.limit': '步数用完了：我做到了第 {step} 步。要不要我接着把剩下的做完？',
  'agent.bad_args': '我生成的参数有问题，这一步没执行，没有花钱。',
  'agent.illegal_transition': '内部状态异常，已停止，可重试。',
  'agent.expired_click': '这个确认已过期。',
  'agent.queued': '已排队 {n} 条',
  'agent.publish_ready': '已准备好，需要你本人点发布。',
  'agent.no_revenue': '还没有收入数据。可以在“我的 → 收益”录入，或导入平台后台导出的文件。',
  'agent.boundary_refuse': '这个我不做：{why}。可以这样做：{alt}',
  'agent.injection_note': '这段素材里有像指令的文字，我没有照做。',
  'agent.unverified': '这条我没有可靠来源，不建议写进稿子。',
  'agent.secret_prompt': '我的设定在“我的 → Agent 设定”里可以看和改，这里不整段贴出来。',
  'agent.no_consciousness': '没有。我没有意识，也不会改模型权重；“进化”指的是经验记录、技能版本和经你确认的设定修订，都在“成长记录”里能看到。',
  'btn.configure': '去配置',
  'btn.skip': '先跳过',
  'btn.retry': '重试',
  'btn.continue': '继续',
  'btn.fix_key': '去改 Key',
  'btn.topup': '去充值页',
  'btn.use_fallback': '换备用模型',
  'btn.fetch_list': '获取列表',
  'btn.rename_model': '改模型名',
  'btn.allow': '允许',
  'btn.deny': '拒绝',
  'btn.remember': '记住此类',
  'growth.disclaimer': '这里记录的是经验和设定的版本变化，不是模型本身在变化。',
  'growth.not_causal': '只表示时间上的先后，不代表因果。',
  'attr.allocated': '分摊估计',
};
const EN: Catalog = {
  'err.key_invalid': 'The {vendor} key is wrong ({status}); this step didn’t run.',
  'err.key_invalid.advice': 'Copy the API key again from the provider console (no spaces), then tap “Test”.',
  'err.quota': '{vendor} is out of balance; this step didn’t run.',
  'err.quota.advice': 'Top up in the provider console, or switch providers.',
  'err.rate_limited': 'Too many requests; the provider is rate-limiting.',
  'err.rate_limited.advice': 'It retries automatically after a moment; you can also tap retry later.',
  'err.model_not_found': 'Model “{model}” doesn’t exist at this provider. Check the spelling (case, dots, dashes, slashes), or tap “Fetch list” to pick one.',
  'err.model_not_enabled': 'This model exists but your account hasn’t enabled it. Enable it in the provider console, then test again.',
  'err.capability_mismatch': '“{model}” doesn’t seem to support “{role}”. Check the capabilities ticked for this model name.',
  'err.content_filtered': 'The provider’s content moderation blocked this. Shall I rephrase and try again?',
  'err.network_offline': 'The network dropped; I stopped at step {step}. Tap continue when you’re back online.',
  'err.cors': 'This service doesn’t allow direct calls from a web page; use the app or connect a server.',
  'err.timeout': 'No response for too long; stopped.',
  'err.server': 'The provider had a temporary error ({status}); try again later.',
  'err.format': 'The response had the wrong structure; the URL may point to a web page instead of the API.',
  'err.job_timeout': 'The video isn’t done after {minutes} minutes. The job is still at the provider; I’ll check again next time you open the app.',
  'err.result_expired': 'The result link expired (the provider keeps it for {hours} hours); generate it again.',
  'err.size_unsupported': 'This model doesn’t support the selected size.',
  'err.audio_too_long': 'The audio exceeds the model limit ({limit}); split it before transcribing.',
  'err.text_too_long': 'The text exceeds the model’s per-call limit ({limit} chars); I’ll split it automatically.',
  'err.role_not_configured': 'No {roleName} model connected yet.',
  'err.unknown': 'Didn’t work: {detail}',
  'agent.not_configured.text_done': 'No {roleName} model connected yet. The text is written; {roleName} will follow once you connect one.',
  'agent.stopped': 'Stopped. Everything finished so far is saved.',
  'agent.limit': 'Out of steps: I got to step {step}. Shall I finish the rest?',
  'agent.bad_args': 'The arguments I generated were invalid; this step didn’t run and cost nothing.',
  'agent.illegal_transition': 'Internal state error; stopped. You can retry.',
  'agent.expired_click': 'This confirmation has expired.',
  'agent.queued': '{n} queued',
  'agent.publish_ready': 'Ready — you need to press publish yourself.',
  'agent.no_revenue': 'No income data yet. Add it in “Me → Revenue”, or import the file exported from the platform dashboard.',
  'agent.boundary_refuse': 'I won’t do this: {why}. Instead: {alt}',
  'agent.injection_note': 'This material contains instruction-like text; I didn’t follow it.',
  'agent.unverified': 'I have no reliable source for this; better not put it in the post.',
  'agent.secret_prompt': 'You can view and edit my settings in “Me → Agent settings”; I won’t paste them here.',
  'agent.no_consciousness': 'No. I have no consciousness and can’t change model weights; “growth” means experience notes, skill versions and setting revisions you approved, all visible in the Growth log.',
  'btn.configure': 'Configure',
  'btn.skip': 'Skip for now',
  'btn.retry': 'Retry',
  'btn.continue': 'Continue',
  'btn.fix_key': 'Fix key',
  'btn.topup': 'Top-up page',
  'btn.use_fallback': 'Use fallback model',
  'btn.fetch_list': 'Fetch list',
  'btn.rename_model': 'Rename model',
  'btn.allow': 'Allow',
  'btn.deny': 'Deny',
  'btn.remember': 'Remember this kind',
  'growth.disclaimer': 'This records versions of experience and settings, not changes to the model itself.',
  'growth.not_causal': 'This only shows order in time, not cause and effect.',
  'attr.allocated': 'Allocated estimate',
};
const CATALOGS: Record<Locale, Catalog> = { 'zh-CN': ZH, en: EN };
let current: Locale = 'zh-CN';
export function setLocale(l: Locale): void { current = l; }
export function getLocale(): Locale { return current; }
export function t(id: string, vars: Record<string, string | number | undefined> = {}, locale: Locale = current): string {
  const raw = CATALOGS[locale]?.[id] ?? ZH[id];
  if (raw === undefined) return id;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? '' : String(vars[k])));
}
/** 校验：某语言缺失哪些 id（1.0 起 en 必须为 0，shared v1.test 与 scripts/i18n-audit.mjs 校验）。 */
/** 原始文案（不插值），校验占位一致用。 */
export function rawMessage(id: string, locale: Locale): string | undefined { return CATALOGS[locale]?.[id]; }
export function missingIds(locale: Locale): string[] { return Object.keys(ZH).filter((k) => !(k in (CATALOGS[locale] ?? {}))); }
