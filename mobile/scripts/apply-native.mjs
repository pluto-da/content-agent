#!/usr/bin/env node
/**
 * 把本地应用插件（LocalApps）与所需声明写入 `npx cap add` 生成的原生工程。可重复执行（幂等）。
 *
 * Android：
 *  - 复制 LocalAppsPlugin.java、MainActivity.java（注册插件）、res/xml/file_paths.xml；
 *  - AndroidManifest.xml 增加 <queries>：只声明各平台官方 App 的包名与 URL Scheme（不申请 QUERY_ALL_PACKAGES，
 *    以符合 Google Play 包可见性政策）；增加 FileProvider（分享草稿素材用）。
 *  - 额外包名：环境变量 CA_EXTRA_PACKAGES="com.a.b,com.c.d"。
 * iOS：
 *  - 复制 LocalAppsPlugin.swift、MainViewController.swift 到 ios/App/App/（首次需在 Xcode 中把这两个文件加入 App target）；
 *  - Info.plist 增加 LSApplicationQueriesSchemes；Main.storyboard 的控制器类改为 MainViewController。
 * 用法：node scripts/apply-native.mjs [android|ios]（在 mobile/ 目录下）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'native');

export const KNOWN_PACKAGES = ['com.ss.android.ugc.aweme', 'com.xingin.xhs', 'com.tencent.mm', 'com.zhihu.android', 'com.taobao.idlefish', 'com.twitter.android'];
export const KNOWN_SCHEMES = ['snssdk1128', 'xhsdiscover', 'weixin', 'zhihu', 'fleamarket', 'twitter'];
const PKG_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function android() {
  const app = join(root, 'android', 'app', 'src', 'main');
  if (!existsSync(app)) { console.log('跳过 Android：先运行 npx cap add android'); return; }
  const javaDir = join(app, 'java', 'local', 'contentagent', 'app');
  mkdirSync(javaDir, { recursive: true });
  cpSync(join(native, 'android', 'java', 'local', 'contentagent', 'app'), javaDir, { recursive: true });
  mkdirSync(join(app, 'res', 'xml'), { recursive: true });
  cpSync(join(native, 'android', 'res', 'xml', 'file_paths.xml'), join(app, 'res', 'xml', 'file_paths.xml'));

  const extra = (process.env.CA_EXTRA_PACKAGES ?? '').split(',').map((s) => s.trim()).filter((s) => PKG_RE.test(s));
  const pkgs = [...new Set([...KNOWN_PACKAGES, ...extra])];
  const manifestPath = join(app, 'AndroidManifest.xml');
  let m = readFileSync(manifestPath, 'utf8');
  m = m.replace(/\s*<!-- ca:queries -->[\s\S]*?<!-- \/ca:queries -->/, '');
  m = m.replace(/\s*<!-- ca:provider -->[\s\S]*?<!-- \/ca:provider -->/, '');
  const queries = [
    '    <!-- ca:queries -->',
    '    <queries>',
    ...pkgs.map((p) => `        <package android:name="${p}" />`),
    ...KNOWN_SCHEMES.map((s) => `        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="${s}" /></intent>`),
    '    </queries>',
    '    <!-- /ca:queries -->',
  ].join('\n');
  const provider = [
    '        <!-- ca:provider -->',
    '        <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true">',
    '            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />',
    '        </provider>',
    '        <!-- /ca:provider -->',
  ].join('\n');
  // Capacitor 模板已带 FileProvider 时不重复声明
  if (!/androidx\.core\.content\.FileProvider/.test(m)) m = m.replace(/<\/application>/, `${provider}\n    </application>`);
  else console.log('提示：工程中已有 FileProvider，请确认其 paths 包含 <cache-path name="share" path="share/" />');
  m = m.replace(/<\/manifest>/, `${queries}\n</manifest>`);
  if (/QUERY_ALL_PACKAGES/.test(m)) console.warn('警告：清单中存在 QUERY_ALL_PACKAGES，上架 Google Play 需要特别审批，建议移除');
  writeFileSync(manifestPath, m);
  console.log(`Android：已写入 LocalApps 插件与 <queries>（${pkgs.length} 个包名）`);

  // 版本号与 mobile/package.json 保持一致：versionName = x.y.z，versionCode = x*10000 + y*100 + z
  const gradlePath = join(root, 'android', 'app', 'build.gradle');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const mv = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (existsSync(gradlePath) && mv) {
    const code = Number(mv[1]) * 10000 + Number(mv[2]) * 100 + Number(mv[3]);
    const g = readFileSync(gradlePath, 'utf8')
      .replace(/versionCode\s+\d+/, `versionCode ${code}`)
      .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    writeFileSync(gradlePath, g);
    console.log(`Android：versionName ${version}，versionCode ${code}`);
  }
}

function ios() {
  const app = join(root, 'ios', 'App', 'App');
  if (!existsSync(app)) { console.log('跳过 iOS：先在 macOS 上运行 npx cap add ios'); return; }
  for (const f of ['LocalAppsPlugin.swift', 'MainViewController.swift']) cpSync(join(native, 'ios', 'App', f), join(app, f));
  const plistPath = join(app, 'Info.plist');
  let p = readFileSync(plistPath, 'utf8');
  p = p.replace(/\s*<key>LSApplicationQueriesSchemes<\/key>\s*<array>[\s\S]*?<\/array>/, '');
  const arr = `\n\t<key>LSApplicationQueriesSchemes</key>\n\t<array>\n${KNOWN_SCHEMES.map((s) => `\t\t<string>${s}</string>`).join('\n')}\n\t</array>`;
  p = p.replace(/<dict>/, `<dict>${arr}`);
  writeFileSync(plistPath, p);
  const sb = join(app, 'Base.lproj', 'Main.storyboard');
  if (existsSync(sb)) {
    const s = readFileSync(sb, 'utf8').replace(/customClass="CAPBridgeViewController" customModule="Capacitor"/, 'customClass="MainViewController" customModule="App" customModuleProvider="target"');
    writeFileSync(sb, s);
  }
  console.log('iOS：已复制 Swift 文件并写入 LSApplicationQueriesSchemes。首次请在 Xcode 中把 LocalAppsPlugin.swift、MainViewController.swift 加入 App target。');
}

const which = process.argv[2];
if (!which || which === 'android') android();
if (!which || which === 'ios') ios();
