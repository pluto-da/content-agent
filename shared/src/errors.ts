/**
 * 把模型 / 网络错误翻译成白话原因 + 建议（本机模式“测试连接”和生成共用；服务端也可复用）。
 * kind 便于界面决定下一步按钮。
 */
export type ModelErrorKind = 'key' | 'address' | 'model' | 'quota' | 'rate' | 'network' | 'cors' | 'timeout' | 'server' | 'format' | 'unknown';
export interface FriendlyError { kind: ModelErrorKind; reason: string; advice: string; status?: number }

export function classifyHttpError(status: number, body = ''): FriendlyError {
  const b = body.toLowerCase();
  if (status === 401 || status === 403 || /invalid[_ ]?(api[_ ]?)?key|authentication|unauthori[sz]ed|incorrect api key/.test(b))
    return { kind: 'key', status, reason: 'Key 不对', advice: '请到服务商后台重新复制 API Key（注意不要带空格），再点“测试连接”' };
  if (status === 402 || /insufficient|quota|balance|余额|欠费|arrear/.test(b))
    return { kind: 'quota', status, reason: '额度不足', advice: '账户余额或套餐额度用完了，请到服务商后台充值或换一个 Key' };
  if (status === 429) return { kind: 'rate', status, reason: '请求太频繁', advice: '服务商限流了，等一分钟再试' };
  if (status === 404 && /model/.test(b)) return { kind: 'model', status, reason: '模型名不对', advice: '检查模型名是否拼写正确，或从下拉里选一个' };
  if (status === 404) return { kind: 'address', status, reason: '地址不对', advice: 'Base URL 一般以 /v1 结尾，不要带 /chat/completions；可点“恢复官方地址”' };
  if (status === 400 && /model/.test(b)) return { kind: 'model', status, reason: '模型名不对或不支持', advice: '换一个模型名再试' };
  if (status >= 500) return { kind: 'server', status, reason: '服务商暂时出错', advice: `服务商返回 ${status}，稍后再试` };
  return { kind: 'unknown', status, reason: `请求失败（${status}）`, advice: body ? body.slice(0, 120) : '请检查地址、Key 与模型名' };
}

/** fetch 抛出的异常（没有拿到 HTTP 状态）。web=true 表示在浏览器里直连，失败多半是跨域。 */
export function classifyThrown(e: unknown, opts: { web: boolean; timedOut?: boolean; offline?: boolean }): FriendlyError {
  if (opts.timedOut || (e instanceof Error && e.name === 'AbortError')) return { kind: 'timeout', reason: '连接超时', advice: '网络较慢或地址不可达，换个网络再试' };
  if (opts.offline) return { kind: 'network', reason: '网络不通', advice: '当前设备没有联网，连上网络后再试' };
  if (opts.web) return { kind: 'cors', reason: '跨域被拒或网络不通', advice: '该服务不允许网页直连，请用 App 或连接服务端；也可能是地址写错或网络不通' };
  return { kind: 'network', reason: '网络不通', advice: '无法连到这个地址，检查网络与 Base URL' };
}
