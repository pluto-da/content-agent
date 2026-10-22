package local.contentagent.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 内置网页插件（0.7.0）：在 App 内用原生 WebView 页面（InAppWebActivity）打开各平台官方网页版。
 *
 * 硬边界：
 * - 不向第三方页面注入脚本（没有 addJavascriptInterface / evaluateJavascript），不自动填表、不自动点击；
 * - 不把第三方页面内容或 Cookie 交给本 App 的网页层：clearData 只在原生层把该平台站点的 Cookie 置为过期，
 *   返回值只有一个数量；
 * - 登录态由系统 WebView 的 CookieManager 持久化（直到用户点“退出该平台登录 / 清除全部内置网页数据”）。
 */
@CapacitorPlugin(name = "BuiltinWeb")
public class BuiltinWebPlugin extends Plugin {
    static final Pattern HOST = Pattern.compile("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$");

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = true;
        String reason = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && WebView.getCurrentWebViewPackage() == null) {
                ok = false;
                reason = "系统 WebView 未安装或已停用";
            }
        } catch (Throwable t) {
            ok = false;
            reason = "系统 WebView 不可用";
        }
        ret.put("available", ok);
        if (reason != null) ret.put("reason", reason);
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith("https://")) { call.reject("只能打开 https 官方网址"); return; }
        Intent i = new Intent(getContext(), InAppWebActivity.class);
        i.putExtra(InAppWebActivity.EXTRA_URL, url);
        i.putExtra(InAppWebActivity.EXTRA_TITLE, call.getString("title", ""));
        i.putExtra(InAppWebActivity.EXTRA_PLATFORM, call.getString("platform", ""));
        i.putExtra(InAppWebActivity.EXTRA_PACKAGE, call.getString("packageName", ""));
        i.putExtra(InAppWebActivity.EXTRA_HINT, call.getString("hint", ""));
        i.putExtra(InAppWebActivity.EXTRA_HOSTS, hosts(call).toArray(new String[0]));
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("内置网页打开失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void clearData(PluginCall call) {
        final List<String> hs = hosts(call);
        if (hs.isEmpty()) { call.reject("没有要清除的站点"); return; }
        getActivity().runOnUiThread(() -> {
            int n = clearHosts(getContext(), hs.toArray(new String[0]));
            JSObject ret = new JSObject();
            ret.put("cleared", n);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager cm = CookieManager.getInstance();
            cm.removeAllCookies(null);
            cm.flush();
            WebStorage.getInstance().deleteAllData();
            try { new WebView(getContext()).clearCache(true); } catch (Throwable ignored) { }
            call.resolve();
        });
    }

    private static List<String> hosts(PluginCall call) {
        List<String> out = new ArrayList<>();
        JSArray arr = call.getArray("hosts", new JSArray());
        for (int k = 0; k < arr.length(); k++) {
            try {
                String h = arr.getString(k).toLowerCase();
                if (HOST.matcher(h).matches()) out.add(h);
            } catch (JSONException ignored) { }
        }
        return out;
    }

    /**
     * 删除这些站点（及其父域）上的 Cookie 和网页存储。Cookie 名只在这里用于设置过期，不离开原生层。
     * 返回置为过期的 Cookie 个数。
     */
    static int clearHosts(Context ctx, String[] hosts) {
        CookieManager cm = CookieManager.getInstance();
        int n = 0;
        Set<String> all = new LinkedHashSet<>();
        for (String h : hosts) { all.add(h); if (!h.startsWith("www.")) all.add("www." + h); }
        for (String h : all) {
            String url = "https://" + h + "/";
            String raw = cm.getCookie(url);
            if (raw != null && !raw.isEmpty()) {
                for (String part : raw.split(";")) {
                    int eq = part.indexOf('=');
                    String name = (eq >= 0 ? part.substring(0, eq) : part).trim();
                    if (name.isEmpty()) continue;
                    String gone = name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/";
                    cm.setCookie(url, gone);
                    cm.setCookie(url, gone + "; Secure");
                    for (String d : parents(h)) {
                        cm.setCookie(url, gone + "; Domain=." + d);
                        cm.setCookie(url, gone + "; Domain=." + d + "; Secure");
                    }
                    n++;
                }
            }
            WebStorage.getInstance().deleteOrigin("https://" + h);
        }
        cm.flush();
        return n;
    }

    /** a.b.example.com → [a.b.example.com, b.example.com, example.com]（至少两级）。 */
    static List<String> parents(String host) {
        List<String> out = new ArrayList<>();
        String h = host;
        while (h.indexOf('.') > 0 && h.indexOf('.') != h.lastIndexOf('.')) { out.add(h); h = h.substring(h.indexOf('.') + 1); }
        out.add(h);
        return out;
    }

    static boolean isHttp(Uri u) {
        String s = u == null ? null : u.getScheme();
        return "https".equalsIgnoreCase(s) || "http".equalsIgnoreCase(s);
    }
}
