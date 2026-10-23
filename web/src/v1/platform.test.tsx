/**
 * 1.0 第二部分单测：三端 Key 后端（SecretBackend: ios-keychain / electron-safeStorage）与 iOS 内置网页（SFSafariViewController）。
 * 原生层用假实现注入：iOS 钥匙串插件 = mobile/native/ios/App/SecureKeysPlugin.swift；桌面 = desktop/main.cjs 的 safe:* IPC。
 * 真机 / 真系统行为（TestFlight、钥匙串持久化、Windows DPAPI / macOS Keychain）见 design/acceptance-v1.md 待真机 / 待资质项。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalDb, db } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { setSecret, getSecret } from '../local/secrets';
import { setSecureKeysForTest, keyStorageDiag, activeBackend, migrationState, resetSecretBackend, preferredBackend, type SecureKeysPlugin } from '../local/secretBackend';
import { builtinMode, openBuiltin } from '../builtin';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** 假 iOS 钥匙串：一把独立 AES-GCM 密钥；wipe() 模拟“换手机 / 钥匙串里没有这把密钥”。 */
function fakeKeychain() {
  let key: CryptoKey | null = null;
  const ensure = async () => (key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  const p: SecureKeysPlugin = {
    async info(a) { if (a.create) await ensure(); return { available: true, hasKey: !!key, isInsideSecureHardware: false, securityLevel: 'ios_keychain', storageBackend: 'kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly' }; },
    async encrypt(a) { const k = await ensure(); const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), data: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(a.plaintext)))) }; },
    async decrypt(a) { if (!key) throw Object.assign(new Error('钥匙串里没有对应的密钥'), { code: 'NO_KEY' }); return { plaintext: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a.iv) }, key, unb64(a.data))) }; },
    async reset() { key = null; return { ok: true }; },
  };
  return { p, wipe: () => { key = null; } };
}
/** 假桌面 safeStorage：只做可逆变换，模拟主进程 safe:encrypt / safe:decrypt。 */
function fakeElectron(ok = true) {
  const calls: string[] = [];
  (window as unknown as { contentAgent: unknown }).contentAgent = {
    isElectron: true, platform: 'win32', openExternal: vi.fn(),
    safeStorage: {
      available: async () => ({ ok, backend: ok ? 'dpapi' : 'basic_text' }),
      encrypt: async (s: string) => { calls.push('enc'); return btoa(unescape(encodeURIComponent(`DPAPI:${s}`))); },
      decrypt: async (b: string) => { calls.push('dec'); const v = decodeURIComponent(escape(atob(b))); if (!v.startsWith('DPAPI:')) throw new Error('bad'); return v.slice(6); },
    },
  };
  return calls;
}
const asIos = () => { (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }; };
const reset = () => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; delete (window as unknown as { contentAgent?: unknown }).contentAgent; };
const KEY = 'sk-test-v1-IOSKEYCHAIN12345678';

beforeEach(() => { resetLocalDb(); resetSecureKey(); setSecureKeysForTest(null); reset(); });
afterEach(() => { reset(); setSecureKeysForTest(null); vi.restoreAllMocks(); vi.doUnmock('@capacitor/browser'); });

describe('SecretBackend: ios-keychain', () => {
  it('iOS App 首选 ios-keychain；旧 WebCrypto 密文一次性迁入钥匙串，迁完删除旧密钥，逐条可解', async () => {
    await setSecret('secret:i1', KEY);
    const kc = fakeKeychain(); setSecureKeysForTest(kc.p); asIos(); resetSecretBackend();
    expect(preferredBackend()).toBe('ios-keychain');
    expect((await activeBackend()).id).toBe('ios-keychain');
    expect(await migrationState()).toMatchObject({ status: 'done', from: 'webcrypto', to: 'ios-keychain', count: 1 });
    expect((await db.getKV<Record<string, { b?: string }>>('secrets'))!['secret:i1']!.b).toBe('ios-keychain');
    expect(await db.getKV('secure.key')).toBeNull();
    expect(await getSecret('secret:i1')).toBe(KEY);
    const d = await keyStorageDiag();
    expect(d.active).toBe('ios-keychain');
    expect(d.label).toMatch(/iOS 钥匙串/);
    await setSecret('secret:i2', 'tp-new-ABCDEFGH12345678');
    expect((await db.getKV<Record<string, { b?: string }>>('secrets'))!['secret:i2']!.b).toBe('ios-keychain');
  });
  it('插件不可用（未注册 SecureKeys）：回退 WebCrypto 并提示，Key 不丢', async () => {
    await setSecret('secret:i1', KEY);
    setSecureKeysForTest({ info: async () => { throw new Error('not implemented'); } } as unknown as SecureKeysPlugin); asIos(); resetSecretBackend();
    expect((await activeBackend()).id).toBe('webcrypto');
    expect((await keyStorageDiag()).fallbackReason).toMatch(/iPhone.*钥匙串插件/);
    expect(await getSecret('secret:i1')).toBe(KEY);
  });
  it('钥匙串里没有密钥（换机恢复备份）：解不开的 Key 标为需重填，不崩', async () => {
    const kc = fakeKeychain(); setSecureKeysForTest(kc.p); asIos(); resetSecretBackend();
    await setSecret('secret:i3', KEY);
    kc.wipe();
    expect(await getSecret('secret:i3')).toBe('');
  });
});

describe('SecretBackend: electron-safeStorage（桌面）', () => {
  it('桌面 App 首选 electron-safeStorage 并迁移，密文由系统钥匙串加密', async () => {
    await setSecret('secret:d1', KEY);
    const calls = fakeElectron(true); resetSecretBackend();
    expect(preferredBackend()).toBe('electron-safeStorage');
    expect((await activeBackend()).id).toBe('electron-safeStorage');
    expect(await getSecret('secret:d1')).toBe(KEY);
    expect(calls).toContain('enc');
    expect((await keyStorageDiag()).hardware.storageBackend).toBe('dpapi');
  });
  it('Linux 只有 basic_text：视为不可用，回退 WebCrypto 并提示', async () => {
    await setSecret('secret:d2', KEY);
    fakeElectron(false); resetSecretBackend();
    expect((await activeBackend()).id).toBe('webcrypto');
    expect((await keyStorageDiag()).fallbackReason).toMatch(/系统钥匙串不可用/);
  });
});

describe('iOS 内置网页：SFSafariViewController（@capacitor/browser）', () => {
  it('iOS 走 sheet 模式，调用 Browser.open（iOS 上即 SFSafariViewController），只开 https', async () => {
    asIos();
    expect(builtinMode()).toBe('sheet');
    const open = vi.fn(async () => {});
    vi.doMock('@capacitor/browser', () => ({ Browser: { open } }));
    const c = { id: 'xiaohongshu', label: '小红书', url: 'https://creator.xiaohongshu.com/', publishUrl: 'https://creator.xiaohongshu.com/publish/publish', hosts: ['xiaohongshu.com'] } as unknown as Parameters<typeof openBuiltin>[0];
    const r = await openBuiltin(c, { publish: true });
    expect(r.ok).toBe(true);
    expect(open).toHaveBeenCalledWith({ url: 'https://creator.xiaohongshu.com/publish/publish' });
    const bad = await openBuiltin(c, { url: 'http://example.com' });
    expect(bad.ok).toBe(false);
  });
});
