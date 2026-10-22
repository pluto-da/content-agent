package local.contentagent.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;

import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 0.8.0 系统分享目标“超级工作台”（ACTION_SEND：text/plain 与 image/*）与选中文字菜单“发给 Agent”（ACTION_PROCESS_TEXT）。
 * 透明、只接收用户主动分享 / 选中的内容（只读，不回写），交给 BrowserHost 插件排队，再把 MainActivity（singleTask）带到前台后立即 finish。
 * 网页层先出预览抽屉，用户确认后才进入素材箱与会话。
 */
public class ShareReceiverActivity extends Activity {
    static final int MAX_IMAGE = 2 * 1024 * 1024;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try { handle(getIntent()); } catch (Throwable ignored) { }
        Intent main = new Intent(this, MainActivity.class);
        main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(main);
        finish();
    }

    protected String channel() { return "share"; }

    private void handle(Intent in) {
        if (in == null) return;
        JSObject item = new JSObject();
        item.put("channel", channel());
        String action = in.getAction();
        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence t = in.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (t == null || t.length() == 0) return;
            item.put("kind", "text");
            item.put("text", t.toString().substring(0, Math.min(t.length(), 5000)));
            BrowserHostPlugin.enqueue(item);
            return;
        }
        if (!Intent.ACTION_SEND.equals(action)) return;
        String type = in.getType() == null ? "" : in.getType();
        String text = in.getStringExtra(Intent.EXTRA_TEXT);
        String subject = in.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null) item.put("title", subject.substring(0, Math.min(subject.length(), 200)));
        if (text != null) item.put("text", text.substring(0, Math.min(text.length(), 5000)));
        if (type.startsWith("image/")) {
            Uri uri = Build.VERSION.SDK_INT >= 33 ? in.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : legacyStream(in);
            if (uri != null) {
                String data = readImage(uri);
                if (data != null) { item.put("image", "data:" + type + ";base64," + data); item.put("mime", type); }
            }
            item.put("kind", "image");
        } else item.put("kind", "share");
        if (text == null && !item.has("image")) return;
        BrowserHostPlugin.enqueue(item);
    }

    @SuppressWarnings("deprecation")
    private static Uri legacyStream(Intent in) { return in.getParcelableExtra(Intent.EXTRA_STREAM); }

    private String readImage(Uri uri) {
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_IMAGE) return null; // 太大不收，界面提示改用文字
            }
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return null;
        }
    }
}
