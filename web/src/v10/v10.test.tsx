/**
 * 0.10.0 单测：Key 硬件绑定（SecretBackend 选择、一次性迁移、失败回退、重装后无法解密）、传输（JS multipart、FormData 失败重试、Base64 文本解码、白话失败）、
 * 提醒（Android 13+ 权限、精确闹钟、预排 / 取消、拒权不崩、系统已弹的不重复）。原生插件用假实现注入（真机行为见 design/acceptance-v10.md 待真机项）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSecrets, bytesToBase64 } from '@content-agent/shared';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey, saveCred, readCred } from '../local/secure';
import { setSecret, getSecret, undecryptableSecrets, secretStorageInfoAsync } from '../local/secrets';
import { setSecureKeysForTest, keyStorageDiag, activeBackend, migrationState, retryMigration, resetSecretBackend, setRequireAuth, type SecureKeysPlugin } from '../local/secretBackend';
import { buildMultipart, decodeBinaryBody, webTransport, getTransportTrace, clearTransportTrace, plainTransportMessage } from '../v9/transport';
import { addReminder, cancelReminder, listReminders, notifyPerms, requestNotifyPermission, setLocalNotificationsForTest, syncNativeSchedule, tick } from '../v9/reminders';
import { exportBackup } from '../v9/backup';

/** 假的 SecureKeys：用一把独立的 WebCrypto 密钥模拟 AndroidKeyStore；reset() 模拟“卸载重装后密钥不在了”。 */
function fakeKeystore(o: { fail?: 'encrypt' | 'info'; hw?: boolean } = {}) {
  let key: CryptoKey | null = null;
  let auth = false;
  const calls: string[] = [];
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const ensure = async (requireAuth?: boolean) => { if (!key) { key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); auth = !!requireAuth; } return key; };
  const p: SecureKeysPlugin = {
    async info(a) { calls.push('info'); if (o.fail === 'info') throw new Error('boom'); if (a.create) await ensure(a.requireAuth); return { available: true, hasKey: !!key, isInsideSecureHardware: o.hw ?? true, securityLevel: o.hw === false ? 'software' : 'strongbox', strongBox: o.hw !== false, strongBoxFeature: true, userAuthRequired: auth, sdk: 34 }; },
    async encrypt(a) { calls.push('encrypt'); if (o.fail === 'encrypt') throw Object.assign(new Error('加密失败：ProviderException'), { code: 'ENCRYPT_FAILED' }); const k = await ensure(a.requireAuth); const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), data: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(a.plaintext)))) }; },
    async decrypt(a) { calls.push('decrypt'); if (!key) throw Object.assign(new Error('本机没有对应的密钥'), { code: 'NO_KEY' }); try { return { plaintext: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a.iv) }, key, unb64(a.data))) }; } catch { throw Object.assign(new Error('密文与本机密钥不匹配'), { code: 'BAD_TAG' }); } },
    async reset() { calls.push('reset'); key = null; return { ok: true }; },
  };
  return { p, calls, wipe: () => { key = null; } };
}
const asAndroid = () => { (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }; };
const asWeb = () => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; };
const KEY = 'sk-test-v10-ABCDEFGH12345678';

beforeEach(() => { resetLocalDb(); resetSecureKey(); setSecureKeysForTest(null); asWeb(); clearTransportTrace(); vi.unstubAllGlobals(); });
afterEach(() => { asWeb(); setSecureKeysForTest(null); setLocalNotificationsForTest(null); vi.restoreAllMocks(); });

describe('Key 硬件绑定（SecretBackend）', () => {
  it('网页版：用 WebCrypto；诊断页如实写“不适用”', async () => {
    await setSecret('secret:a1', KEY);
    expect(await getSecret('secret:a1')).toBe(KEY);
    const d = await keyStorageDiag();
    expect(d).toMatchObject({ preferred: 'webcrypto', active: 'webcrypto' });
  });
  it('安卓 App：旧 WebCrypto 密文（模型 Key + 数据源凭证）一次性迁入硬件密钥库，迁完删除旧密钥，逐条可解', async () => {
    await setSecret('secret:a1', KEY);
    await saveCred('x-api', { token: 'tok-ABCDEFGH12345678', path: '/v2' }, ['token']);
    expect(((await db.getKV<Record<string, { b?: string }>>('secrets'))!['secret:a1']!.b)).toBeUndefined();
    const ks = fakeKeystore(); setSecureKeysForTest(ks.p); asAndroid(); resetSecretBackend();
    expect((await activeBackend()).id).toBe('android-keystore');
    const st = await migrationState();
    expect(st).toMatchObject({ status: 'done', from: 'webcrypto', to: 'android-keystore', count: 2 });
    expect((await db.getKV<Record<string, { b?: string }>>('secrets'))!['secret:a1']!.b).toBe('android-keystore');
    expect(await db.getKV('secure.key')).toBeNull();
    expect(await getSecret('secret:a1')).toBe(KEY);
    expect((await readCred('x-api'))!.token).toBe('tok-ABCDEFGH12345678');
    const d = await keyStorageDiag();
    expect(d.hardware.isInsideSecureHardware).toBe(true);
    expect(d.hardware.securityLevel).toBe('strongbox');
    // 新保存直接走硬件密钥库
    await setSecret('secret:b2', 'sk-new-ZZZZYYYYXXXX1111');
    expect((await db.getKV<Record<string, { b?: string }>>('secrets'))!['secret:b2']!.b).toBe('android-keystore');
  });
  it('迁移失败（硬件加密报错）：什么都不写，继续用 WebCrypto，并明确提示原因；可重试', async () => {
    await setSecret('secret:a1', KEY);
    const before = JSON.stringify(await db.getKV('secrets'));
    const ks = fakeKeystore({ fail: 'encrypt' }); setSecureKeysForTest(ks.p); asAndroid(); resetSecretBackend();
    expect((await activeBackend()).id).toBe('webcrypto');
    expect(JSON.stringify(await db.getKV('secrets'))).toBe(before);
    expect(await getSecret('secret:a1')).toBe(KEY);
    expect(await migrationState()).toMatchObject({ status: 'failed' });
    const info = await secretStorageInfoAsync();
    expect(info.warn).toMatch(/没有成功.*WebCrypto/);
    const ok = fakeKeystore(); setSecureKeysForTest(ok.p);
    expect((await retryMigration()).id).toBe('android-keystore');
    expect(await getSecret('secret:a1')).toBe(KEY);
  });
  it('插件不可用（老版本 APK / 非安卓）：回退 WebCrypto 并提示', async () => {
    asAndroid(); resetSecretBackend();   // 未注入假插件：registerPlugin 的网页实现会报未实现
    expect((await activeBackend()).id).toBe('webcrypto');
    expect((await keyStorageDiag()).fallbackReason).toMatch(/SecureKeys/);
  });
  it('卸载重装 / 换机（硬件密钥不在了）：旧密文无法解密（预期），界面列出需要重填的 Key，不崩溃', async () => {
    const ks = fakeKeystore(); setSecureKeysForTest(ks.p); asAndroid(); resetSecretBackend();
    await setSecret('secret:a1', KEY);
    expect(await getSecret('secret:a1')).toBe(KEY);
    ks.wipe();
    expect(await getSecret('secret:a1')).toBe('');
    expect(await undecryptableSecrets()).toEqual(['secret:a1']);
    expect((await keyStorageDiag()).undecryptable).toContain('secret:a1');
    await setSecret('secret:a1', KEY);   // 重填后恢复
    expect(await undecryptableSecrets()).toEqual([]);
  });
  it('切换“需要解锁手机”：全部重新加密后仍可解', async () => {
    const ks = fakeKeystore(); setSecureKeysForTest(ks.p); asAndroid(); resetSecretBackend();
    await setSecret('secret:a1', KEY);
    expect(await setRequireAuth(true)).toEqual({ ok: true });
    expect(ks.calls).toContain('reset');
    expect(await getSecret('secret:a1')).toBe(KEY);
    expect((await keyStorageDiag()).hardware.userAuthRequired).toBe(true);
  });
  it('备份 / 日志 / VFS 扫描：迁移到硬件密钥库后备份仍 0 命中', async () => {
    const ks = fakeKeystore(); setSecureKeysForTest(ks.p); asAndroid(); resetSecretBackend();
    await setSecret('secret:a1', KEY);
    const zip = await exportBackup({ includeMedia: false });
    const text = new TextDecoder().decode(zip);
    expect(text.includes(KEY)).toBe(false);
    expect(findSecrets(text).filter((f) => f.value?.includes?.('ABCDEFGH'))).toHaveLength(0);
  });
});

describe('传输：multipart / 二进制兜底', () => {
  const parts = [{ name: 'model', value: '模型-A' }, { name: 'file', filename: 'a.png', mime: 'image/png', base64: bytesToBase64(new Uint8Array([137, 80, 78, 71, 0, 255])) }];
  it('JS 构造 multipart：边界、字段、文件字节逐字正确', () => {
    const m = buildMultipart(parts, 'BOUND');
    expect(m.contentType).toBe('multipart/form-data; boundary=BOUND');
    const s = new TextDecoder('latin1').decode(m.body);
    expect(s).toContain('--BOUND\r\nContent-Disposition: form-data; name="model"\r\n\r\n');
    expect(new TextDecoder().decode(m.body)).toContain('模型-A');
    expect(s).toContain('filename="a.png"\r\nContent-Type: image/png\r\n\r\n');
    const i = m.body.indexOf(137); expect([...m.body.subarray(i, i + 6)]).toEqual([137, 80, 78, 71, 0, 255]);
    expect(s.endsWith('--BOUND--\r\n')).toBe(true);
  });
  it('FormData 发送抛错 → 自动用 JS 构造重试一次；trace 只记字段名与大小', async () => {
    const seen: { ct?: string; isFd: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { const isFd = init.body instanceof FormData; seen.push({ ct: (init.headers as Record<string, string>)['content-type'], isFd }); if (isFd) throw new TypeError('Failed to serialize FormData'); return new Response('{"ok":1}', { status: 200 }); }));
    const r = await webTransport.send({ method: 'POST', url: 'https://api.example.com/v1/audio/transcriptions', headers: { Authorization: `Bearer ${KEY}` }, responseType: 'json', multipart: parts }, { timeoutMs: 5000 });
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(2); expect(seen[1]!.ct).toMatch(/^multipart\/form-data; boundary=/);
    const tr = getTransportTrace()[0]!;
    expect(tr.mode).toBe('retry-js'); expect(tr.fields!.map((f) => f.name)).toEqual(['model', 'file']);
    expect(JSON.stringify(getTransportTrace())).not.toContain(KEY);
  });
  it('二进制：原生层把音频当 Base64 文本返回时识别并解码；真二进制原样', () => {
    const audio = new Uint8Array(64).map((_, i) => (i * 7) % 256);
    const asText = new TextEncoder().encode(bytesToBase64(audio));
    expect(decodeBinaryBody(asText, 'audio/mpeg')).toMatchObject({ from: 'base64-text' });
    expect([...decodeBinaryBody(asText, 'audio/mpeg').bytes]).toEqual([...audio]);
    expect(decodeBinaryBody(audio, 'audio/mpeg').from).toBe('binary');
    expect(decodeBinaryBody(asText, 'application/json').from).toBe('binary');
  });
  it('失败路径白话：网页跨域、上传失败、下载失败、空文件', async () => {
    expect(plainTransportMessage('Failed to fetch', { web: true })).toMatch(/跨域/);
    expect(plainTransportMessage('x', { multipart: true, web: false })).toMatch(/上传文件.*重试/);
    expect(plainTransportMessage('x', { binary: true, web: false })).toMatch(/下载生成结果/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'audio/mpeg' } })));
    await expect(webTransport.send({ method: 'POST', url: 'https://api.example.com/tts', headers: {}, responseType: 'binary' }, { timeoutMs: 5000 })).rejects.toThrow(/空文件/);
  });
});

describe('提醒：Android 13+ 通知权限与精确闹钟', () => {
  function fakeLN(o: { display?: string; exact?: string; grant?: string } = {}) {
    const st = { display: o.display ?? 'granted', exact: o.exact ?? 'granted' };
    const scheduled = new Map<number, { at: Date; body: string }>(); const cancelled: number[] = [];
    const L = {
      checkPermissions: vi.fn(async () => ({ display: st.display })),
      requestPermissions: vi.fn(async () => { st.display = o.grant ?? st.display; return { display: st.display }; }),
      checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: st.exact })),
      changeExactNotificationSetting: vi.fn(async () => ({ exact_alarm: st.exact })),
      schedule: vi.fn(async (a: { notifications: { id: number; body: string; schedule: { at: Date; allowWhileIdle: boolean } }[] }) => { for (const n of a.notifications) scheduled.set(n.id, { at: n.schedule.at, body: n.body }); return { notifications: [] }; }),
      cancel: vi.fn(async (a: { notifications: { id: number }[] }) => { for (const n of a.notifications) { scheduled.delete(n.id); cancelled.push(n.id); } }),
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
    };
    setLocalNotificationsForTest(L as never);
    return { L, scheduled, cancelled, st };
  }
  const future = (min: number) => new Date(Date.now() + min * 60000).toISOString();
  it('有权限：新提醒立即预排到系统闹钟（allowWhileIdle，App 关闭也能弹）；取消即撤销', async () => {
    const f = fakeLN();
    const r = await addReminder({ text: '看数据', at: future(30) });
    expect(f.L.schedule).toHaveBeenCalledTimes(1);
    expect(f.L.schedule.mock.calls[0]![0].notifications[0]!.schedule.allowWhileIdle).toBe(true);
    expect((await listReminders())[0]!.nativeAt).toBe(r.at);
    await cancelReminder(r.id);
    expect(f.cancelled).toHaveLength(1); expect(f.scheduled.size).toBe(0);
  });
  it('拒绝通知权限：不预排、不崩溃；到点只在 App 内显示', async () => {
    const f = fakeLN({ display: 'denied', grant: 'denied' });
    await addReminder({ text: '拒权也不崩', at: future(1) });
    expect(f.L.schedule).not.toHaveBeenCalled();
    expect(await syncNativeSchedule()).toMatchObject({ skipped: 'no_permission' });
    expect(await requestNotifyPermission()).toBe('denied');
    const fired: string[] = []; window.addEventListener('ca:reminder-fired', (e) => fired.push((e as CustomEvent).detail.text));
    const n = await tick(new Date(Date.now() + 2 * 60000), async () => false);
    expect(n).toBe(1); expect(fired).toContain('拒权也不崩');
  });
  it('精确闹钟未开：如实报告，提醒仍预排（系统可能延迟）', async () => {
    const f = fakeLN({ exact: 'denied' });
    expect(await notifyPerms()).toMatchObject({ display: 'granted', exact: 'denied', native: true });
    await addReminder({ text: 'x', at: future(5) });
    expect(f.L.schedule).toHaveBeenCalled();
  });
  it('系统已预排并弹出的那一次，App 打开时不再重复弹；重复提醒排下一次', async () => {
    const f = fakeLN();
    await addReminder({ text: '每周一', at: future(1), rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' });
    const send = vi.fn(async () => true);
    await tick(new Date(Date.now() + 2 * 60000), send);
    expect(send).not.toHaveBeenCalled();
    const r = (await listReminders())[0]!;
    expect(r.status).toBe('scheduled');
    expect(f.L.schedule).toHaveBeenCalledTimes(2);
  });
  it('网页版（无原生插件）：只报告浏览器通知状态，不报精确闹钟', async () => {
    setLocalNotificationsForTest(null);
    const p = await notifyPerms();
    expect(p.native).toBe(false); expect(p.exact).toBe('unsupported');
  });
});
