import { useCallback, useEffect, useRef, useState } from 'react';
import { onStoreChange, type StoreKey } from './db';

/**
 * 0.8.1：统一订阅机制。常驻 / 保活组件（Agent 面板、侧栏、总览卡、角标、素材箱…）只挂载一次，
 * 过去“挂载时读一次 IndexedDB”就再也不更新——在别处保存后要刷新页面才看得到。
 * 现在：keys 里任一集合 / 键被写入后（同一轮的多次写入合并成一次）重新读取；可选在路由切换、窗口回到前台时也重读。
 */
export interface StoreOpts { onNavigate?: boolean }

/** 订阅变更并调用 cb（合并同一轮的多次写入）。返回值无；组件卸载自动退订。 */
export function useStoreChange(keys: readonly StoreKey[] | '*', cb: () => void, opts: StoreOpts = {}): void {
  const cbRef = useRef(cb);
  useEffect(() => { cbRef.current = cb; });
  const sig = keys === '*' ? '*' : [...keys].sort().join('|');
  const nav = !!opts.onNavigate;
  useEffect(() => {
    const want = sig === '*' ? null : new Set(sig.split('|'));
    let queued = false;
    const fire = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; cbRef.current(); }); };
    const off = onStoreChange((k) => { if (!want || want.has(k)) fire(); });
    const onVis = () => { if (document.visibilityState === 'visible') fire(); };
    if (nav) { window.addEventListener('hashchange', fire); window.addEventListener('focus', fire); document.addEventListener('visibilitychange', onVis); }
    return () => { off(); if (nav) { window.removeEventListener('hashchange', fire); window.removeEventListener('focus', fire); document.removeEventListener('visibilitychange', onVis); } };
  }, [sig, nav]);
}

/** 读取一个本机值并保持最新。读失败时给白话错误（不静默）。 */
export function useStoreValue<T>(load: () => Promise<T>, keys: readonly StoreKey[] | '*', opts: StoreOpts = {}): { value: T | undefined; error: string | null; reload: () => void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const seq = useRef(0);
  const alive = useRef(true);
  const reload = useCallback(() => {
    const n = ++seq.current;
    loadRef.current().then(
      (v) => { if (alive.current && n === seq.current) { setValue(v); setError(null); } },
      (e) => { if (alive.current && n === seq.current) setError(`读取本机数据失败：${e instanceof Error ? e.message : String(e)}`); },
    );
  }, []);
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, [reload]);
  useStoreChange(keys, reload, opts);
  return { value, error, reload };
}
