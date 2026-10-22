package local.contentagent.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 0.8.0 原生流式 HTTP（只用于模型请求）：CapacitorHttp 会把流式响应缓冲到结束才交给页面（ionic-team/capacitor #7890），
 * 这里按 capacitor-stream-http（MIT）的思路自写：HttpURLConnection 分块读取，事件 response / chunk / end / error，可取消。
 * 请求头（含 Key）只用于这次连接，不写日志。
 */
@CapacitorPlugin(name = "StreamHttp")
public class StreamHttpPlugin extends Plugin {
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        HttpURLConnection c = active.remove(id);
        if (c != null) new Thread(c::disconnect).start();
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String id = call.getString("id", "");
        final String url = call.getString("url", "");
        final String method = call.getString("method", "POST");
        final String body = call.getString("body", "");
        final int timeout = call.getInt("timeoutMs", 180000);
        final JSObject headers = call.getObject("headers", new JSObject());
        if (!url.startsWith("https://") && !url.startsWith("http://")) { call.reject("只允许 http(s) 地址"); return; }
        call.resolve();
        new Thread(() -> run(id, url, method, body, timeout, headers), "stream-http-" + id).start();
    }

    private void run(String id, String url, String method, String body, int timeout, JSONObject headers) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            active.put(id, c);
            c.setRequestMethod(method);
            c.setConnectTimeout(Math.min(timeout, 30000));
            c.setReadTimeout(timeout);
            c.setDoInput(true);
            c.setRequestProperty("accept", "text/event-stream, application/json");
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, headers.optString(k)); }
            if (body != null && !body.isEmpty()) {
                c.setDoOutput(true);
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream os = c.getOutputStream()) { os.write(b); }
            }
            int status = c.getResponseCode();
            JSObject r = new JSObject();
            r.put("id", id); r.put("status", status);
            notifyListeners("response", r);
            InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (is != null) {
                try (Reader rd = new InputStreamReader(is, StandardCharsets.UTF_8)) {
                    char[] buf = new char[2048];
                    int n;
                    while ((n = rd.read(buf)) > 0) {
                        if (!active.containsKey(id)) break; // 已取消
                        JSObject ch = new JSObject();
                        ch.put("id", id); ch.put("data", new String(buf, 0, n));
                        notifyListeners("chunk", ch);
                    }
                }
            }
            JSObject e = new JSObject();
            e.put("id", id);
            notifyListeners("end", e);
        } catch (Throwable t) {
            if (!active.containsKey(id)) return; // 取消导致的中断不报错
            JSObject e = new JSObject();
            e.put("id", id);
            e.put("message", t instanceof SocketTimeoutException ? "timeout" : String.valueOf(t.getClass().getSimpleName()));
            e.put("timeout", t instanceof SocketTimeoutException);
            notifyListeners("error", e);
        } finally {
            active.remove(id);
            if (c != null) c.disconnect();
        }
    }
}
