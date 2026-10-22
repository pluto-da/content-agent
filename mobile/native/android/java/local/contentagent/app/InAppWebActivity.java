package local.contentagent.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
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
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * 内置网页页面（0.7.0）：在本 App 内打开平台官方网页版，用户自己登录、浏览、发布。
 * 工具栏：返回（网页后退，没有可退时关闭）、标题 + 网址、刷新、⋯（打开官方 App / 用浏览器打开 / 复制网址 / 退出该平台登录）、关闭。
 *
 * 硬边界：不注入脚本（无 addJavascriptInterface / evaluateJavascript / loadUrl("javascript:")）、不自动填表或点击、
 * 不读取页面内容；非 http(s) 跳转（如页面想唤起 App）一律拦截并提示；页面请求相机 / 麦克风 / 定位一律拒绝；
 * 文件上传只走系统文件选择器，由用户自己挑选。
 */
public class InAppWebActivity extends Activity {
    static final String EXTRA_URL = "url";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_PLATFORM = "platform";
    static final String EXTRA_PACKAGE = "packageName";
    static final String EXTRA_HINT = "hint";
    static final String EXTRA_HOSTS = "hosts";
    private static final int REQ_FILE = 7101;

    private WebView web;
    private ProgressBar progress;
    private TextView titleView;
    private TextView hostView;
    private LinearLayout errorView;
    private TextView errorTitle;
    private TextView errorText;
    private ValueCallback<Uri[]> fileCallback;
    private String startUrl;
    private String label;
    private String pkg;
    private String[] hosts;
    private boolean dark;

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }
    private int fg() { return dark ? 0xFFEDEDED : 0xFF1F1F1F; }
    private int muted() { return dark ? 0xFF9A9A9A : 0xFF6B6B6B; }
    private int bg() { return dark ? 0xFF161616 : 0xFFFAFAF9; }
    private int line() { return dark ? 0xFF2A2A2A : 0xFFE6E4E0; }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        startUrl = in.getStringExtra(EXTRA_URL);
        label = in.getStringExtra(EXTRA_TITLE);
        pkg = in.getStringExtra(EXTRA_PACKAGE);
        hosts = in.getStringArrayExtra(EXTRA_HOSTS);
        String hint = in.getStringExtra(EXTRA_HINT);
        if (startUrl == null || !startUrl.startsWith("https://")) { finish(); return; }
        if (label == null) label = "";
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg());

        // ---- 工具栏 ----
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(4), 0);
        bar.setBackgroundColor(bg());
        bar.addView(toolButton("‹", "返回", v -> goBack()));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(4), 0, dp(4), 0);
        titleView = new TextView(this);
        titleView.setTextColor(fg());
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setText(label + "（内置网页）");
        hostView = new TextView(this);
        hostView.setTextColor(muted());
        hostView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hostView.setSingleLine(true);
        hostView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        titles.addView(titleView);
        titles.addView(hostView);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(toolButton("↻", "刷新", v -> { hideError(); web.reload(); }));
        final Button more = toolButton("⋯", "更多", null);
        more.setOnClickListener(v -> showMenu(more));
        bar.addView(more);
        bar.addView(toolButton("✕", "关闭", v -> finish()));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        View divider = new View(this);
        divider.setBackgroundColor(line());
        root.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));

        // ---- 提示条：发布由你本人点击 ----
        if (hint != null && !hint.isEmpty()) {
            final TextView tip = new TextView(this);
            tip.setText(hint + "  ✕");
            tip.setTextColor(fg());
            tip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            tip.setBackgroundColor(dark ? 0xFF23243A : 0xFFEEF0FB);
            tip.setPadding(dp(16), dp(10), dp(16), dp(10));
            tip.setContentDescription("提示：" + hint + "。点按关闭");
            tip.setOnClickListener(v -> tip.setVisibility(View.GONE));
            root.addView(tip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setIndeterminate(false);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        FrameLayout stack = new FrameLayout(this);
        web = new WebView(this);
        stack.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        stack.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(stack, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        // Android 15+ 默认边到边：把工具栏放在状态栏下面、网页放在手势条上面
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(s.left, s.top, s.right, s.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);          // 平台网页自身需要脚本运行；本 App 不注入任何脚本
        ws.setDomStorageEnabled(true);          // 平台网页登录态常用 localStorage
        ws.setDatabaseEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setSupportMultipleWindows(false);    // target=_blank 在当前页打开
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setMediaPlaybackRequiresUserGesture(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true); // 扫码登录（如微信、QQ）需要跨站 Cookie

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, cd, mime, len) -> toast("内置网页不支持下载，可在 ⋯ 里用浏览器打开"));
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl);
        hostView.setText(Uri.parse(startUrl).getHost());
    }

    private Button toolButton(String text, String desc, View.OnClickListener l) {
        Button b = new Button(this, null, android.R.attr.borderlessButtonStyle);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setTextColor(fg());
        b.setMinWidth(dp(48));
        b.setMinimumWidth(dp(48));
        b.setPadding(0, 0, 0, 0);
        b.setContentDescription(desc);
        if (l != null) b.setOnClickListener(l);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        return b;
    }

    private LinearLayout buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(28), dp(28), dp(28), dp(28));
        box.setBackgroundColor(bg());
        box.setClickable(true);
        errorTitle = new TextView(this);
        errorTitle.setTextColor(fg());
        errorTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        errorTitle.setTypeface(Typeface.DEFAULT_BOLD);
        errorTitle.setGravity(Gravity.CENTER);
        errorText = new TextView(this);
        errorText.setTextColor(muted());
        errorText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(8), 0, dp(20));
        box.addView(errorTitle);
        box.addView(errorText);
        Button retry = new Button(this);
        retry.setText("重试");
        retry.setAllCaps(false);
        retry.setOnClickListener(v -> { hideError(); web.reload(); });
        box.addView(retry);
        if (pkg != null && !pkg.isEmpty()) {
            Button app = new Button(this);
            app.setText("打开官方 App");
            app.setAllCaps(false);
            app.setOnClickListener(v -> openOfficialApp());
            box.addView(app);
        }
        Button close = new Button(this, null, android.R.attr.borderlessButtonStyle);
        close.setText("关闭");
        close.setAllCaps(false);
        close.setTextColor(fg());
        close.setOnClickListener(v -> finish());
        box.addView(close);
        return box;
    }

    private void showError(String title, String detail) {
        errorTitle.setText(title);
        errorText.setText(detail + (pkg != null && !pkg.isEmpty() ? "\n可以改用官方 App。" : ""));
        errorView.setVisibility(View.VISIBLE);
    }

    private void hideError() { if (errorView != null) errorView.setVisibility(View.GONE); }

    private void showMenu(View anchor) {
        PopupMenu m = new PopupMenu(this, anchor);
        if (pkg != null && !pkg.isEmpty()) m.getMenu().add(0, 1, 0, "打开官方 App");
        m.getMenu().add(0, 2, 1, "用浏览器打开");
        m.getMenu().add(0, 3, 2, "复制网址");
        if (hosts != null && hosts.length > 0) m.getMenu().add(0, 4, 3, "退出" + label + "登录（清除数据）");
        m.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: openOfficialApp(); return true;
                case 2: openInBrowser(); return true;
                case 3: copyUrl(); return true;
                case 4: confirmLogout(); return true;
                default: return false;
            }
        });
        m.show();
    }

    private void openOfficialApp() {
        Intent i = pkg == null || pkg.isEmpty() ? null : getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { toast("没有找到" + label + "的官方 App，请先安装"); return; }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (ActivityNotFoundException e) { toast("无法打开官方 App"); }
    }

    private void openInBrowser() {
        String u = web.getUrl() != null ? web.getUrl() : startUrl;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (ActivityNotFoundException e) { toast("没有可用的浏览器"); }
    }

    private void copyUrl() {
        ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        String u = web.getUrl() != null ? web.getUrl() : startUrl;
        if (cb != null) { cb.setPrimaryClip(ClipData.newPlainText("url", u)); toast("网址已复制"); }
    }

    private void confirmLogout() {
        new AlertDialog.Builder(this)
                .setTitle("退出" + label + "登录？")
                .setMessage("会删除" + label + "在本软件内置网页里的登录与网页数据，下次需要重新登录。")
                .setNegativeButton("取消", null)
                .setPositiveButton("退出登录", (d, w) -> {
                    BuiltinWebPlugin.clearHosts(this, hosts);
                    toast("已退出" + label + "的内置网页登录");
                    web.clearHistory();
                    web.loadUrl(startUrl);
                })
                .show();
    }

    private void goBack() {
        if (errorView.getVisibility() == View.VISIBLE) { hideError(); if (web.canGoBack()) return; }
        if (web.canGoBack()) web.goBack(); else finish();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { goBack(); }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush(); // 登录态写盘，App 被杀也不丢
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) {
            ViewGroup p = (ViewGroup) web.getParent();
            if (p != null) p.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (BuiltinWebPlugin.isHttp(u)) return false;
            // 页面想唤起 App（xhsdiscover://、intent:// 等）：不自动跳转
            toast("页面想打开其他 App，已拦截。需要时点 ⋯ → 打开官方 App");
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            hideError();
            if (url != null) hostView.setText(Uri.parse(url).getHost());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            int code = error.getErrorCode();
            String why;
            if (code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT) why = "网络连不上（" + error.getDescription() + "）。请检查网络后重试。";
            else if (code == ERROR_UNSUPPORTED_SCHEME) why = "这个链接不是网页，内置网页打不开。";
            else why = "加载失败：" + error.getDescription();
            showError(label + "网页版没有打开", why);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse resp) {
            if (!request.isForMainFrame()) return;
            int s = resp.getStatusCode();
            if (s == 403 || s == 451) showError(label + "拒绝了内置网页", "平台返回 " + s + "，可能不允许在 App 内置网页中使用网页版。");
            else if (s == 429) showError(label + "暂时拒绝访问", "平台返回 429（请求过多），请稍后再试。");
            else if (s >= 500) showError(label + "网页版暂时不可用", "平台返回 " + s + "，请稍后重试。");
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); // 证书有问题一律不继续
            showError("安全证书有问题", "已停止加载，以保护你的账号。");
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            progress.setProgress(p);
            progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            if (title != null && !title.isEmpty() && !title.startsWith("http")) titleView.setText(title);
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                Intent i = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(i, REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                toast("没有可用的文件选择器");
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) { request.deny(); }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
    }
}
