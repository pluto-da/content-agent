import { emptyModelsV3, addModelEntry, bindRole, type ModelsStateV3, type ProviderAccount, type RoleId, type Transport, type HttpRequest, type HttpResponse, type CallDeps } from '../src/index.js';
export function acct(id: string, vendor: string, extra: Partial<ProviderAccount> = {}): ProviderAccount { return { id, vendor, label: id, baseURL: '', region: 'cn', models: [], hasKey: true, ...extra }; }
export function stateWith(entries: { acc: ProviderAccount; model: string; roles: RoleId[]; bind?: ('primary' | 'fallback')[] }[]): ModelsStateV3 {
  let s = emptyModelsV3();
  for (const e of entries) {
    let a = s.accounts.find((x) => x.id === e.acc.id);
    if (!a) { a = structuredClone(e.acc); s.accounts.push(a); }
    const r = addModelEntry(a, { model: e.model, roles: e.roles });
    if (!r.ok) throw new Error(r.error);
    for (const slot of e.bind ?? []) for (const role of e.roles) s = bindRole(s, role, slot, r.entry);
  }
  return s;
}
export function fakeTransport(handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>): Transport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return { calls, async send(req) { calls.push(req); return handler(req); } };
}
export function deps(state: ModelsStateV3, transport: Transport, extra: Partial<CallDeps> = {}): CallDeps {
  return { state, transport, getKey: async () => 'sk-test-0000000000000000', sleep: async () => {}, random: () => 0.5, ...extra };
}
export const ok = (body: unknown, extra: Partial<HttpResponse> = {}): HttpResponse => ({ status: 200, text: JSON.stringify(body), ...extra });
