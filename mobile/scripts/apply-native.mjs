#!/usr/bin/env node
/**
 * 把本地应用插件（LocalApps）与所需声明写入 `npx cap add` 生成的原生工程。可重复执行（幂等）。
 *
 * Android：
 *  - 复制 LocalAppsPlugin.java、BuiltinWebPlugin.java + InAppWebActivity.java（0.7.0 内置网页）、SplitScreenPlugin.java（0.7.0 平板分屏）、
 *    MainActivity.java（注册插件）、res/xml/file_paths.xml；
 *  - AndroidManifest.xml 声明 InAppWebActivity（不导出，configChanges 避免旋转 / 分屏调整大小时重载网页）；
 *  - 0.8.0：复制 BrowserHostPlugin / PlatformWebClient / StreamHttpPlugin / ShareReceiverActivity / ProcessTextActivity；
 *    声明 ShareReceiverActivity（ACTION_SEND text/plain、image/*，标签“超级工作台”）与 ProcessTextActivity（ACTION_PROCESS_TEXT，标签“发给 Agent”），
 *    均为透明、exported=true、只接收文字 / 图片；<queries> 增加 PROCESS_TEXT intent；app/build.gradle 增加 androidx.webkit 依赖（多 Profile）；
 *    MainActivity 保持 singleTask（不改动模板的 launchMode）。
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

export const KNOWN_PACKAGES = ['com.ss.android.ugc.aweme', 'com.xingin.xhs', 'com.tencent.mm', 'com.zhihu.android', 'com.taobao.idlefish', 'com.twitter.android', 'tv.danmaku.bili', 'com.smile.gifmaker'];
export const KNOWN_SCHEMES = ['snssdk1128', 'xhsdiscover', 'weixin', 'zhihu', 'fleamarket', 'twitter', 'bilibili', 'kwai'];
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
  m = m.replace(/\s*<!-- ca:inappweb -->[\s\S]*?<!-- \/ca:inappweb -->/, '');
  m = m.replace(/\s*<!-- ca:inbox -->[\s\S]*?<!-- \/ca:inbox -->/, '');
  const inAppWeb = [
    '        <!-- ca:inappweb -->',
    '        <activity android:name=".InAppWebActivity" android:exported="false" android:theme="@style/AppTheme.NoActionBar"',
    '            android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|uiMode|density"',
    '            android:windowSoftInputMode="adjustResize" android:resizeableActivity="true" />',
    '        <!-- /ca:inappweb -->',
  ].join('\n');
  m = m.replace(/<\/application>/, `${inAppWeb}\n    </application>`);
  // 0.8.0：系统分享目标 + 选中文字菜单（透明、只读，收到后立即交给 MainActivity）
  const inbox = [
    '        <!-- ca:inbox -->',
    '        <activity android:name=".ShareReceiverActivity" android:exported="true" android:label="超级工作台" android:theme="@android:style/Theme.Translucent.NoTitleBar" android:excludeFromRecents="true" android:noHistory="true" android:taskAffinity="">',
    '            <intent-filter>',
    '                <action android:name="android.intent.action.SEND" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <data android:mimeType="text/plain" />',
    '            </intent-filter>',
    '            <intent-filter>',
    '                <action android:name="android.intent.action.SEND" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <data android:mimeType="image/*" />',
    '            </intent-filter>',
    '        </activity>',
    '        <activity android:name=".ProcessTextActivity" android:exported="true" android:label="发给 Agent" android:theme="@android:style/Theme.Translucent.NoTitleBar" android:excludeFromRecents="true" android:noHistory="true" android:taskAffinity="">',
    '            <intent-filter>',
    '                <action android:name="android.intent.action.PROCESS_TEXT" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <data android:mimeType="text/plain" />',
    '            </intent-filter>',
    '        </activity>',
    '        <!-- /ca:inbox -->',
  ].join('\n');
  m = m.replace(/<\/application>/, `${inbox}\n    </application>`);
  if (/android:name="\.MainActivity"/.test(m) && !/android:launchMode="singleTask"/.test(m)) console.warn('警告：MainActivity 不是 singleTask，分享 / 选中文字会打开新实例');
  const queries = [
    '    <!-- ca:queries -->',
    '    <queries>',
    ...pkgs.map((p) => `        <package android:name="${p}" />`),
    ...KNOWN_SCHEMES.map((s) => `        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="${s}" /></intent>`),
    '        <intent><action android:name="android.intent.action.PROCESS_TEXT" /><data android:mimeType="text/plain" /></intent>',
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
  console.log(`Android：已写入 LocalApps / BuiltinWeb / SplitScreen / BrowserHost / StreamHttp 插件、InAppWebActivity、ShareReceiverActivity、ProcessTextActivity 与 <queries>（${pkgs.length} 个包名 + PROCESS_TEXT）`);

  // 版本号与 mobile/package.json 保持一致：versionName = x.y.z，versionCode = x*10000 + y*100 + z
  const gradlePath = join(root, 'android', 'app', 'build.gradle');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const mv = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (existsSync(gradlePath) && mv) {
    const code = Number(mv[1]) * 10000 + Number(mv[2]) * 100 + Number(mv[3]);
    let g = readFileSync(gradlePath, 'utf8')
      .replace(/versionCode\s+\d+/, `versionCode ${code}`)
      .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    // 0.8.0：多 Profile 需要 androidx.webkit（与 Capacitor 8.5.3 core 相同版本 1.14.0），幂等写入
    g = g.replace(/\s*\/\/ ca:webkit\n\s*implementation "androidx\.webkit:webkit:[^"]+"/, '');
    g = g.replace(/dependencies\s*\{/, 'dependencies {\n    // ca:webkit\n    implementation "androidx.webkit:webkit:1.14.0"');
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
