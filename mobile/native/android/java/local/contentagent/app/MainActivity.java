package local.contentagent.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** 注册本地插件 LocalApps、BuiltinWeb、SplitScreen（由 mobile/scripts/apply-native.mjs 写入生成的 Android 工程）。 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalAppsPlugin.class);
        registerPlugin(BuiltinWebPlugin.class);   // 0.7.0 内置网页
        registerPlugin(SplitScreenPlugin.class);  // 0.7.0 平板分屏
        super.onCreate(savedInstanceState);
    }
}
