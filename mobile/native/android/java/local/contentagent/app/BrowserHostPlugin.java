package local.contentagent.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 0.8.0 BrowserHost：把平台网页嵌进主界面。
 * 在 Capacitor WebView 之上（同一父容器）加一个容器 FrameLayout，每个保活平台一个系统 WebView（非当前的 GONE）；
 * 网页层用占位元素的矩形调用 setFrame（CSS px + devicePixelRatio），这里换算成物理像素并加上 Capacitor WebView 的偏移。
 * 每个平台独立持久会话：系统 WebView 支持 MULTI_PROFILE 时用 Profile "ca-<平台>"，否则退回默认 Profile（与 0.7.0 相同）。
 * 不注入脚本、不读页面内容、不读 Cookie 值给网页层；只回传 url / title / 前进后退 / 进度。
 * 另负责把系统分享 / 选中文字（ShareReceiverActivity、ProcessTextActivity）收到的内容交给网页层（takePending + inboxReceived）。
 */
@CapacitorPlugin(name = "BrowserHost")
public class BrowserHostPlugin extends Plugin implements PlatformWebClient.Listener {
    static final int REQ_FILE = 7201;
    private static BrowserHostPlugin instance;
    private static final List<JSObject> pending = new ArrayList<>();

    private FrameLayout container;
    private final Map<String, WebView> views = new HashMap<>();
    private final Map<String, String[]> hosts = new HashMap<>();
    private String current;
    private boolean visible = true;
    private ValueCallback<Uri[]> fileCallback;
    private int fx, fy, fw, fh;

    @Override
    public void load() { instance = this; }

    /* ---------- 分享 / 选中文字进来 ---------- */
    static void enqueue(JSObject item) {
        synchronized (pending) { pending.add(item); }
        BrowserHostPlugin p = instance;
        if (p != null) {
            JSObject ev = new JSObject();
            ev.put("count", pending.size());
            p.notifyListeners("inboxReceived", ev, true);
        }
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pending) { for (JSObject o : pending) arr.put(o); pending.clear(); }
        JSObject ret = new JSObject();
        ret.put("items", arr);
        call.resolve(ret);
    }

    /* ---------- 内存紧张 ---------- */
    static void trimMemory(int level) {
        BrowserHostPlugin p = instance;
        if (p == null) return;
        JSObject ev = new JSObject();
        ev.put("level", level);
        p.notifyListeners("trimMemory", ev);
    }

    static void onFileResult(int resultCode, Intent data) {
        BrowserHostPlugin p = instance;
        if (p == null || p.fileCallback == null) return;
        p.fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        p.fileCallback = null;
    }

    private boolean multiProfile() {
        try { return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE); } catch (Throwable t) { return false; }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok;
        try { ok = WebViewCompat.getCurrentWebViewPackage(getContext()) != null || Build.VERSION.SDK_INT < 26; } catch (Throwable t) { ok = false; }
        ret.put("available", ok);
        ret.put("multiProfile", multiProfile());
        try { android.content.pm.PackageInfo pi = WebViewCompat.getCurrentWebViewPackage(getContext()); if (pi != null) ret.put("webviewVersion", pi.versionName); } catch (Throwable ignored) { }
        call.resolve(ret);
    }

    private FrameLayout ensureContainer() {
        if (container != null) return container;
        WebView main = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) main.getParent();
        container = new FrameLayout(getContext());
        container.setClickable(false);
        parent.addView(container, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        container.bringToFront();
        return container;
    }

    private static String[] arr(PluginCall call, String key) {
        JSArray a = call.getArray(key, new JSArray());
        List<String> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) { try { out.add(a.getString(i).toLowerCase()); } catch (JSONException ignored) { } }
        return out.toArray(new String[0]);
    }

    private static boolean httpsUrl(String url) {
        try { Uri u = Uri.parse(url); return "https".equalsIgnoreCase(u.getScheme()) && u.getHost() != null; } catch (Throwable t) { return false; }
    }

    private static boolean inHosts(String url, String[] hs) {
        if (hs == null || hs.length == 0) return true;
        String h = Uri.parse(url).getHost();
        if (h == null) return false;
        h = h.toLowerCase();
        for (String x : hs) if (h.equals(x) || h.endsWith("." + x)) return true;
        return false;
    }

    @PluginMethod
    public void open(PluginCall call) {
        final String platform = call.getString("platform", "");
        final String url = call.getString("url", "");
        final String profile = call.getString("profile", "ca-" + platform);
        if (platform.isEmpty() || !httpsUrl(url)) { call.reject("只允许 https 网址"); return; }
        hosts.put(platform, arr(call, "hosts"));
        getActivity().runOnUiThread(() -> {
            WebView w = views.get(platform);
            if (w == null) {
                w = new WebView(getActivity());
                if (multiProfile()) {
                    try { ProfileStore.getInstance().getOrCreateProfile(profile); WebViewCompat.setProfile(w, profile); } catch (Throwable ignored) { /* 退回默认 Profile */ }
                }
                PlatformWebClient.configure(w);
                w.setWebViewClient(PlatformWebClient.client(platform, this));
                w.setWebChromeClient(PlatformWebClient.chrome(platform, this));
                w.setVisibility(View.GONE);
                ensureContainer().addView(w, frameParams());
                views.put(platform, w);
                w.loadUrl(url);
            }
            call.resolve();
        });
    }

    private FrameLayout.LayoutParams frameParams() {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.max(1, fw), Math.max(1, fh));
        lp.leftMargin = fx; lp.topMargin = fy;
        return lp;
    }

    @PluginMethod
    public void show(PluginCall call) {
        final String platform = call.getString("platform", "");
        getActivity().runOnUiThread(() -> {
            current = platform;
            for (Map.Entry<String, WebView> e : views.entrySet()) e.getValue().setVisibility(visible && e.getKey().equals(platform) ? View.VISIBLE : View.GONE);
            WebView w = views.get(platform);
            if (w != null) { w.onResume(); emitNav(platform, w, w.getProgress()); }
            call.resolve();
        });
    }

    @PluginMethod
    public void hideAll(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            current = null;
            for (WebView w : views.values()) { w.setVisibility(View.GONE); w.onPause(); }
            CookieManager.getInstance().flush();
            call.resolve();
        });
    }

    @PluginMethod
    public void setFrame(PluginCall call) {
        final double dpr = call.getDouble("dpr", (double) getContext().getResources().getDisplayMetrics().density);
        final double x = call.getDouble("x", 0.0), y = call.getDouble("y", 0.0), w = call.getDouble("width", 0.0), h = call.getDouble("height", 0.0);
        getActivity().runOnUiThread(() -> {
            WebView main = getBridge().getWebView();
            fx = (int) Math.round(main.getX() + x * dpr);
            fy = (int) Math.round(main.getY() + y * dpr);
            fw = (int) Math.round(w * dpr);
            fh = (int) Math.round(h * dpr);
            for (WebView v : views.values()) v.setLayoutParams(frameParams());
            if (container != null) container.bringToFront();
            call.resolve();
        });
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        final boolean v = Boolean.TRUE.equals(call.getBoolean("visible", true));
        getActivity().runOnUiThread(() -> {
            visible = v;
            for (Map.Entry<String, WebView> e : views.entrySet()) e.getValue().setVisibility(v && e.getKey().equals(current) ? View.VISIBLE : View.GONE);
            call.resolve();
        });
    }

    private interface Op { void run(WebView w); }
    private void withView(PluginCall call, Op op) {
        final String platform = call.getString("platform", "");
        getActivity().runOnUiThread(() -> {
            WebView w = views.get(platform);
            if (w == null) { call.reject("这个平台还没有打开"); return; }
            op.run(w);
            call.resolve();
        });
    }

    @PluginMethod public void goBack(PluginCall call) { withView(call, w -> { if (w.canGoBack()) w.goBack(); }); }
    @PluginMethod public void goForward(PluginCall call) { withView(call, w -> { if (w.canGoForward()) w.goForward(); }); }
    @PluginMethod public void reload(PluginCall call) { withView(call, WebView::reload); }
    @PluginMethod public void stop(PluginCall call) { withView(call, WebView::stopLoading); }

    @PluginMethod
    public void loadUrl(PluginCall call) {
        final String platform = call.getString("platform", "");
        final String url = call.getString("url", "");
        if (!httpsUrl(url) || !inHosts(url, hosts.get(platform))) { call.reject("只允许该平台官方域名内的 https 网址"); return; }
        withView(call, w -> w.loadUrl(url));
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        final String platform = call.getString("platform", "");
        getActivity().runOnUiThread(() -> { destroyView(platform); call.resolve(); });
    }

    private void destroyView(String platform) {
        WebView w = views.remove(platform);
        if (w == null) return;
        ViewGroup p = (ViewGroup) w.getParent();
        if (p != null) p.removeView(w);
        w.destroy();
        CookieManager.getInstance().flush();
    }

    @PluginMethod
    public void clearData(PluginCall call) {
        final String platform = call.getString("platform", "");
        final String[] hs = arr(call, "hosts");
        getActivity().runOnUiThread(() -> {
            destroyView(platform);
            int n = 0;
            boolean viaProfile = false;
            if (multiProfile()) {
                try { viaProfile = ProfileStore.getInstance().deleteProfile("ca-" + platform); } catch (Throwable ignored) { }
            }
            if (!viaProfile) n = BuiltinWebPlugin.clearHosts(getContext(), hs); // 只在原生层删除，Cookie 名与值都不离开原生层
            JSObject ret = new JSObject();
            ret.put("cleared", viaProfile ? 1 : n);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        final String platform = call.getString("platform", "");
        getActivity().runOnUiThread(() -> {
            WebView w = views.get(platform);
            call.resolve(w == null ? new JSObject() : state(platform, w, w.getProgress()));
        });
    }

    private JSObject state(String platform, WebView w, int progress) {
        JSObject s = new JSObject();
        s.put("platform", platform);
        s.put("url", w.getUrl() == null ? "" : w.getUrl());
        s.put("title", w.getTitle() == null ? "" : w.getTitle());
        s.put("canGoBack", w.canGoBack());
        s.put("canGoForward", w.canGoForward());
        s.put("progress", progress);
        return s;
    }

    private void emitNav(String platform, WebView w, int progress) { notifyListeners("navState", state(platform, w, progress)); }

    /* ---------- PlatformWebClient.Listener ---------- */
    @Override public void onNav(String platform, WebView view, int progress) { emitNav(platform, view, progress); }

    @Override
    public void onError(String platform, String kind, int status, String url, String description) {
        JSObject e = new JSObject();
        e.put("platform", platform); e.put("kind", kind); e.put("status", status); e.put("url", url); e.put("description", description);
        notifyListeners("loadError", e);
    }

    @Override
    public void onExternalScheme(String platform, String url) {
        JSObject e = new JSObject();
        e.put("platform", platform); e.put("url", url);
        notifyListeners("externalScheme", e);
    }

    @Override
    public boolean onFileChooser(String platform, ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        try {
            Activity a = getActivity();
            a.startActivityForResult(params.createIntent(), REQ_FILE);
            return true;
        } catch (Throwable t) {
            fileCallback = null;
            return false;
        }
    }

    /** 安卓返回键：当前平台能后退就后退。 */
    boolean handleBack() {
        WebView w = current == null ? null : views.get(current);
        if (w != null && visible && w.getVisibility() == View.VISIBLE && w.canGoBack()) { w.goBack(); return true; }
        return false;
    }
    static boolean back() { return instance != null && instance.handleBack(); }
}
