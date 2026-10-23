package local.contentagent.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * 注册本地插件（由 mobile/scripts/apply-native.mjs 写入生成的 Android 工程）。必须保持 singleTask（分享 / 选中文字回到同一实例）。
 * 0.7.0：LocalApps、BuiltinWeb、SplitScreen；0.8.0：BrowserHost（内嵌平台网页）、StreamHttp（模型流式请求）；0.10.0：SecureKeys。
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalAppsPlugin.class);
        registerPlugin(BuiltinWebPlugin.class);   // 0.7.0 内置网页（全屏查看 / 降级路径）
        registerPlugin(SplitScreenPlugin.class);  // 0.7.0 平板分屏
        registerPlugin(BrowserHostPlugin.class);  // 0.8.0 内嵌平台网页 + 分享进来
        registerPlugin(StreamHttpPlugin.class);   // 0.8.0 模型流式请求
        registerPlugin(SecureKeysPlugin.class);   // 0.10.0 Key 硬件绑定（AndroidKeyStore）
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_RUNNING_LOW) BrowserHostPlugin.trimMemory(level);
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BrowserHostPlugin.REQ_FILE) BrowserHostPlugin.onFileResult(resultCode, data);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (BrowserHostPlugin.back()) return; // 主区是平台网页且能后退
        super.onBackPressed();
    }
}
