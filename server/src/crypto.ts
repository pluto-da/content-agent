import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** 读取或生成主密钥：优先环境变量 CA_MASTER_KEY，否则 data/master.key（权限 600）。 */
export function loadMasterKey(keyFile: string, envValue = process.env.CA_MASTER_KEY): Buffer {
  if (envValue && envValue.length > 0) return createHash('sha256').update(envValue).digest();
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  try {
    chmodSync(keyFile, 0o600);
  } catch {
    /* 部分文件系统不支持 chmod */
  }
  return key;
}

export function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(key: Buffer, payload: string): string {
  const [ivB, tagB, encB] = payload.split('.');
  if (!ivB || !tagB || encB === undefined) throw new Error('密文格式错误');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
}

/** 加密密钥库：一个 JSON 文件，值全部加密。 */
export class SecretVault {
  private data: Record<string, string> = {};
  constructor(
    private readonly file: string,
    private readonly key: Buffer,
  ) {
    if (existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      } catch {
        this.data = {};
      }
    }
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
  set(name: string, value: string): void {
    if (!value) {
      delete this.data[name];
    } else {
      this.data[name] = encrypt(this.key, value);
    }
    this.save();
  }
  get(name: string): string | undefined {
    const v = this.data[name];
    if (!v) return undefined;
    try {
      return decrypt(this.key, v);
    } catch {
      return undefined;
    }
  }
  has(name: string): boolean {
    return Boolean(this.data[name]);
  }
  /** 只返回是否配置与末四位掩码，从不返回明文。 */
  describe(names: string[]): Record<string, { configured: boolean; hint: string }> {
    const out: Record<string, { configured: boolean; hint: string }> = {};
    for (const n of names) {
      const v = this.get(n);
      out[n] = { configured: Boolean(v), hint: v ? `••••${v.slice(-4)}` : '' };
    }
    return out;
  }
}

/** 日志脱敏：遮蔽疑似密钥的字段与长串。 */
export function redact(input: string): string {
  return input
    .replace(/(secret|token|key|password|authorization)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}
