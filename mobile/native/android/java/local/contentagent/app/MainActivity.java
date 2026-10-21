package local.contentagent.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** 注册本地插件 LocalApps（由 mobile/scripts/apply-native.mjs 写入生成的 Android 工程）。 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalAppsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
