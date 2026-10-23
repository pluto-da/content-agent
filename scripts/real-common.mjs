/**
 * 0.11.0 真实联调共用：Node 传输（undici，可走 HTTPS 代理）+ 一个 MiMo 账号的 v9 模型配置（ModelsStateV3）。
 * real-v11.mjs（C5 / C6 trace）与 evals/judge.ts（行为评测判官）共用，保证两边走的是 App 里同一套 callRole + mimo 适配器。
 * Key：MIMO_INJECTED=1 时由网络层按主机注入，脚本不读取真实 Key；否则读 MIMO_API_KEY。任何输出都不写请求头。
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { emptyModelsV3, addModelEntry, bindRole, redact } from '../shared/dist/index.js';

export function mimoEnv() {
  const injected = process.env.MIMO_INJECTED === '1';
  const key = injected ? (process.env.MIMO_API_KEY || 'injected') : (process.env.MIMO_API_KEY ?? '').trim();
  const baseURL = (process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  return { injected, key, baseURL, proxy, clean: (s) => redact(String(s), injected ? [] : [key]) };
}

export function nodeTransport(proxy) {
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  return {
    dispatcher,
    async send(req, o) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), o.timeoutMs);
      const onAbort = () => ctl.abort();
      o.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await undiciFetch(req.url, { method: req.method, headers: req.headers, body: req.body, dispatcher, signal: ctl.signal });
        const text = await res.text();
        return { status: res.status, text, headers: Object.fromEntries(res.headers.entries()) };
      } finally { clearTimeout(t); o.signal?.removeEventListener('abort', onAbort); }
    },
  };
}

/** models: { role: modelId }。先把条目全部挂到账号上再绑定角色（bindRole 会 structuredClone）。 */
export function mimoState(models, baseURL) {
  let state = emptyModelsV3();
  const acc = { id: 'mimo-real', vendor: 'mimo', label: '小米 MiMo', baseURL, region: 'cn', models: [], hasKey: true };
  state.accounts.push(acc);
  const bound = [];
  for (const [role, model] of Object.entries(models)) {
    const e = addModelEntry(acc, { model, roles: [role] });
    if (!e.ok) throw new Error(`addModelEntry ${role} ${model}: ${e.error}`);
    acc.models.push(e.entry);
    bound.push([role, e.entry]);
  }
  for (const [role, entry] of bound) state = bindRole(state, role, 'primary', entry);
  return { state, acc };
}
