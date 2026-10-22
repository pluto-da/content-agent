package local.contentagent.app;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 0.8.0：平台网页的共用导航规则（BrowserHost 内嵌视图使用；规则与 0.7.0 InAppWebActivity 已验证的逻辑一致）。
 *  - 只允许 http(s)，唤起其他 App 的 scheme（xhsdiscover://、intent:// 等）一律拦截并回报给界面；
 *  - 相机 / 定位 / 麦克风权限一律拒绝；证书错误一律停止；
 *  - 主框架网络错误、HTTP 403 / 451 / 429 / 5xx 回报给界面显示白话原因；
 *  - 不注入任何脚本、不读页面内容、不改 UA；只回传 url / title / 前进后退 / 进度。
 */
public class PlatformWebClient {
    public interface Listener {
        void onNav(String platform, WebView view, int progress);
        void onError(String platform, String kind, int status, String url, String description);
        void onExternalScheme(String platform, String url);
        boolean onFileChooser(String platform, ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params);
    }

    /** 只开启平台网页正常运行所需的设置；不开启文件访问，不切换桌面 UA。 */
    @SuppressLint("SetJavaScriptEnabled")
    public static void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);        // 平台网页自身需要；本软件不向页面注入任何脚本
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);  // target=_blank 在当前实例打开
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
    }

    public static WebViewClient client(final String platform, final Listener l) {
        return new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (BuiltinWebPlugin.isHttp(u)) return false;
                l.onExternalScheme(platform, u.toString());
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) { l.onNav(platform, view, 10); }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush(); // 登录态写盘
                l.onNav(platform, view, 100);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) { l.onNav(platform, view, view.getProgress()); }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                int code = error.getErrorCode();
                String kind = (code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT) ? "network" : "network";
                l.onError(platform, kind, 0, request.getUrl().toString(), String.valueOf(error.getDescription()));
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse resp) {
                if (!request.isForMainFrame()) return;
                int s = resp.getStatusCode();
                if (s == 403 || s == 451 || s == 429 || s >= 500) l.onError(platform, "http", s, request.getUrl().toString(), "");
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // 证书有问题一律不继续
                l.onError(platform, "ssl", 0, error.getUrl(), "");
            }
        };
    }

    public static WebChromeClient chrome(final String platform, final Listener l) {
        return new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) { l.onNav(platform, view, p); }

            @Override
            public void onReceivedTitle(WebView view, String title) { l.onNav(platform, view, view.getProgress()); }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) { return l.onFileChooser(platform, cb, params); }

            @Override
            public void onPermissionRequest(PermissionRequest request) { request.deny(); }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
        };
    }
}
