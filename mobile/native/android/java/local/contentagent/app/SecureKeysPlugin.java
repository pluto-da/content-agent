package local.contentagent.app;

import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.security.keystore.UserNotAuthenticatedException;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 0.10.0 SecureKeys：服务商 Key 的硬件绑定加解密（ADR-011）。
 * - 主密钥：AES-256-GCM，生成在 AndroidKeyStore 里（StrongBox 可用时优先），不可导出；WebView 只拿到加密 / 解密结果，拿不到密钥本身；
 * - 可选“需要解锁手机后才能使用”（setUserAuthenticationRequired，有效期 300 秒）；切换时由网页层先全部解密、reset 后再全部加密；
 * - decrypt 永远不会新建密钥：卸载重装 / 换机后密钥不在了，返回 NO_KEY，界面提示重新填写（预期行为）；
 * - 只做加解密，不读写任何文件、不联网、不记录明文。
 */
@CapacitorPlugin(name = "SecureKeys")
public class SecureKeysPlugin extends Plugin {
    static final String ALIAS = "content_agent_master_v1";
    private static final String STORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        return ks;
    }

    private SecretKey existing() throws Exception {
        KeyStore ks = keyStore();
        if (!ks.containsAlias(ALIAS)) return null;
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private boolean strongBoxFeature() {
        return Build.VERSION.SDK_INT >= 28 && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
    }

    private SecretKey generate(boolean requireAuth, boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (requireAuth) {
            b.setUserAuthenticationRequired(true);
            if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(300, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            else setValidity(b);
        }
        if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        kg.init(b.build());
        return kg.generateKey();
    }

    @SuppressWarnings("deprecation")
    private static void setValidity(KeyGenParameterSpec.Builder b) { b.setUserAuthenticationValidityDurationSeconds(300); }

    /** 取主密钥，没有就生成（StrongBox 失败时退回 TEE）。 */
    private SecretKey getOrCreate(boolean requireAuth) throws Exception {
        SecretKey k = existing();
        if (k != null) return k;
        if (strongBoxFeature()) {
            try { return generate(requireAuth, true); }
            catch (StrongBoxUnavailableException e) { /* 退回 TEE */ }
            catch (Exception e) { /* 某些机型 StrongBox 报其它异常，同样退回 */ }
        }
        return generate(requireAuth, false);
    }

    private KeyInfo keyInfo(SecretKey k) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance(k.getAlgorithm(), STORE);
        return (KeyInfo) f.getKeySpec(k, KeyInfo.class);
    }

    @SuppressWarnings("deprecation")
    private static boolean insideSecureHardware(KeyInfo ki) { return ki.isInsideSecureHardware(); }

    private static String levelName(int lvl) {
        switch (lvl) {
            case 2: return "strongbox";            // KeyProperties.SECURITY_LEVEL_STRONGBOX
            case 1: return "trusted_environment";  // SECURITY_LEVEL_TRUSTED_ENVIRONMENT
            case 0: return "software";             // SECURITY_LEVEL_SOFTWARE
            case -2: return "unknown_secure";      // SECURITY_LEVEL_UNKNOWN_SECURE
            default: return "unknown";
        }
    }

    /** 诊断：密钥是否存在、是否在安全硬件里、安全级别、是否 StrongBox、是否要求解锁。create=true 时没有密钥会先生成。 */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("alias", ALIAS);
        ret.put("strongBoxFeature", strongBoxFeature());
        try {
            SecretKey k = call.getBoolean("create", false) ? getOrCreate(call.getBoolean("requireAuth", false)) : existing();
            ret.put("hasKey", k != null);
            if (k != null) {
                KeyInfo ki = keyInfo(k);
                ret.put("isInsideSecureHardware", insideSecureHardware(ki));
                ret.put("userAuthRequired", ki.isUserAuthenticationRequired());
                if (Build.VERSION.SDK_INT >= 31) {
                    int lvl = ki.getSecurityLevel();
                    ret.put("securityLevel", levelName(lvl));
                    ret.put("strongBox", lvl == 2);
                } else {
                    ret.put("securityLevel", insideSecureHardware(ki) ? "trusted_environment" : "software");
                    ret.put("strongBox", false);
                }
            }
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("error", e.getClass().getSimpleName());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plain = call.getString("plaintext");
        if (plain == null) { call.reject("缺少 plaintext", "BAD_INPUT"); return; }
        try {
            SecretKey k = getOrCreate(call.getBoolean("requireAuth", false));
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.ENCRYPT_MODE, k);
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            JSObject ret = new JSObject();
            ret.put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP));
            ret.put("data", Base64.encodeToString(ct, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (UserNotAuthenticatedException e) {
            call.reject("需要先解锁手机", "AUTH_REQUIRED");
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("密钥已失效（更改过锁屏方式）", "KEY_INVALIDATED");
        } catch (Exception e) {
            call.reject("加密失败：" + e.getClass().getSimpleName(), "ENCRYPT_FAILED");
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String iv = call.getString("iv"), data = call.getString("data");
        if (iv == null || data == null) { call.reject("缺少 iv / data", "BAD_INPUT"); return; }
        try {
            SecretKey k = existing();
            if (k == null) { call.reject("本机没有对应的密钥（可能重装过或换了手机）", "NO_KEY"); return; }
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] pt = c.doFinal(Base64.decode(data, Base64.NO_WRAP));
            JSObject ret = new JSObject();
            ret.put("plaintext", new String(pt, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (UserNotAuthenticatedException e) {
            call.reject("需要先解锁手机", "AUTH_REQUIRED");
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("密钥已失效（更改过锁屏方式）", "KEY_INVALIDATED");
        } catch (AEADBadTagException e) {
            call.reject("密文与本机密钥不匹配", "BAD_TAG");
        } catch (Exception e) {
            call.reject("解密失败：" + e.getClass().getSimpleName(), "DECRYPT_FAILED");
        }
    }

    /** 删除主密钥（切换“需要解锁”前由网页层调用；之后 encrypt 会按新参数重新生成）。 */
    @PluginMethod
    public void reset(PluginCall call) {
        try {
            KeyStore ks = keyStore();
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.reject("删除密钥失败：" + e.getClass().getSimpleName(), "RESET_FAILED");
        }
    }
}
