package local.contentagent.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 本地应用插件（Android）。
 * - listLaunchable：列出可启动的应用。受 Android 11+ 包可见性限制，只能看到 AndroidManifest <queries> 中声明的包
 *   （默认只声明各平台官方 App 的包名，不申请 QUERY_ALL_PACKAGES）。
 * - launch：用 getLaunchIntentForPackage 打开 App；有深链接时用 ACTION_VIEW + setPackage 打开。
 * - share：ACTION_SEND / ACTION_SEND_MULTIPLE 定向到该包，附带文字与媒体文件（通过 FileProvider 授权读取）。
 *   打开的是该 App 自己的分享/发布界面，最后的发布由用户本人在 App 内点击；本插件不做任何界面自动化。
 */
@CapacitorPlugin(name = "LocalApps")
public class LocalAppsPlugin extends Plugin {
    private static final Pattern PKG = Pattern.compile("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$");
    private static final Pattern BAD_SCHEME = Pattern.compile("^(javascript|data|vbscript|file|content|intent|about):.*", Pattern.CASE_INSENSITIVE);

    @PluginMethod
    public void listLaunchable(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> infos = pm.queryIntentActivities(main, 0);
        Set<String> seen = new HashSet<>();
        JSArray apps = new JSArray();
        String self = getContext().getPackageName();
        for (ResolveInfo ri : infos) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(self) || !seen.add(pkg)) continue;
            JSObject o = new JSObject();
            o.put("packageName", pkg);
            o.put("label", String.valueOf(ri.loadLabel(pm)));
            apps.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        call.resolve(ret);
    }

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String pkg = call.getString("packageName", "");
        if (!PKG.matcher(pkg).matches()) { call.reject("包名格式不正确"); return; }
        JSObject ret = new JSObject();
        ret.put("installed", getContext().getPackageManager().getLaunchIntentForPackage(pkg) != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName", "");
        String deepLink = call.getString("deepLink", "");
        if (!PKG.matcher(pkg).matches()) { call.reject("包名格式不正确"); return; }
        try {
            Intent i;
            if (deepLink != null && !deepLink.isEmpty()) {
                if (BAD_SCHEME.matcher(deepLink).matches()) { call.reject("深链接协议不允许"); return; }
                i = new Intent(Intent.ACTION_VIEW, Uri.parse(deepLink));
                i.setPackage(pkg);
            } else {
                i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) { call.reject("未安装该应用，或未在 <queries> 中声明该包名"); return; }
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("无法打开应用：" + e.getMessage());
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String pkg = call.getString("packageName", "");
        String text = call.getString("text", "");
        JSArray files = call.getArray("files", new JSArray());
        JSObject headers = call.getObject("headers", new JSObject());
        if (pkg != null && !pkg.isEmpty() && !PKG.matcher(pkg).matches()) { call.reject("包名格式不正确"); return; }
        final String target = pkg;
        // 下载媒体文件需要网络，放到后台线程
        getBridge().execute(() -> {
            try {
                ArrayList<Uri> uris = new ArrayList<>();
                String mime = null;
                File dir = new File(getContext().getCacheDir(), "share");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建缓存目录");
                for (int n = 0; n < files.length() && n < 9; n++) {
                    JSONObject f = files.getJSONObject(n);
                    String url = f.getString("url");
                    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
                    String name = f.optString("name", "file-" + n).replaceAll("[^\\w.-]", "_");
                    File out = new File(dir, name);
                    download(url, headers, out);
                    uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out));
                    String m = f.optString("mime", "*/*");
                    mime = mime == null ? m : (mime.equals(m) ? m : m.split("/")[0].equals(mime.split("/")[0]) ? m.split("/")[0] + "/*" : "*/*");
                }
                Intent i;
                if (uris.size() > 1) {
                    i = new Intent(Intent.ACTION_SEND_MULTIPLE);
                    i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                    i.setType(mime);
                } else if (uris.size() == 1) {
                    i = new Intent(Intent.ACTION_SEND);
                    i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                    i.setType(mime);
                } else {
                    i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                }
                if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent launchIntent;
                if (target != null && !target.isEmpty()) {
                    i.setPackage(target);
                    launchIntent = i;
                } else {
                    launchIntent = Intent.createChooser(i, "分享草稿到应用");
                }
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                final Intent finalIntent = launchIntent;
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(finalIntent);
                        JSObject ret = new JSObject();
                        ret.put("files", uris.size());
                        call.resolve(ret);
                    } catch (ActivityNotFoundException e) {
                        call.reject("该应用不接受此类分享，请改用“复制并打开应用”");
                    }
                });
            } catch (Exception e) {
                call.reject("分享失败：" + e.getMessage());
            }
        });
    }

    private void download(String url, JSObject headers, File out) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        JSONArray keys = headers.names();
        if (keys != null) for (int k = 0; k < keys.length(); k++) {
            String key = keys.getString(k);
            c.setRequestProperty(key, headers.getString(key));
        }
        if (c.getResponseCode() >= 400) throw new Exception("下载素材失败（" + c.getResponseCode() + "）");
        try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) > 0) fo.write(buf, 0, r);
        } finally {
            c.disconnect();
        }
    }
}
