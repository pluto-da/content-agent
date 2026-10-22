package local.contentagent.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.regex.Pattern;

/**
 * 平板分屏插件（0.7.0）：用 FLAG_ACTIVITY_LAUNCH_ADJACENT | NEW_TASK | MULTIPLE_TASK 打开已登记的官方 App，
 * 让它出现在本 App 旁边。只启动 App，不操控 App 内任何界面；最后的发布由用户本人点击。
 * 不支持分屏（Android 7 以下，或非平板且当前不在分屏模式）时不加 LAUNCH_ADJACENT，正常打开并告知网页层。
 */
@CapacitorPlugin(name = "SplitScreen")
public class SplitScreenPlugin extends Plugin {
    private static final Pattern PKG = Pattern.compile("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$");

    private boolean inMultiWindow() {
        Activity a = getActivity();
        return a != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && a.isInMultiWindowMode();
    }

    private boolean largeScreen() {
        return getContext().getResources().getConfiguration().smallestScreenWidthDp >= 600;
    }

    /** 能否请求分屏：Android 7+，且（已在分屏中，或 Android 12L+ 的平板 / 大屏可直接进入分屏）。 */
    private boolean supported() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        return inMultiWindow() || (largeScreen() && Build.VERSION.SDK_INT >= 32);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("supported", supported());
        ret.put("inMultiWindow", inMultiWindow());
        ret.put("largeScreen", largeScreen());
        call.resolve(ret);
    }

    @PluginMethod
    public void openAdjacent(PluginCall call) {
        String pkg = call.getString("packageName", "");
        if (pkg == null || !PKG.matcher(pkg).matches()) { call.reject("包名格式不正确"); return; }
        Intent i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { call.reject("NOT_INSTALLED：未安装该应用，或未在 <queries> 中声明该包名"); return; }
        boolean adjacent = supported();
        boolean before = inMultiWindow();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        if (adjacent) i.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT);
        try {
            getActivity().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("adjacent", adjacent);
            ret.put("inMultiWindow", before);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            call.reject("无法打开应用：" + e.getMessage());
        }
    }
}
