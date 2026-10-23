import Foundation
import Capacitor
import CryptoKit
import Security

/// 1.0 SecretBackend: ios-keychain（与安卓 SecureKeysPlugin 同名同接口：info / encrypt / decrypt / reset）。
/// - 主密钥：256 位随机 AES 密钥，存 iOS 钥匙串（kSecClassGenericPassword，kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly：
///   仅本机、不随 iCloud 钥匙串同步、不进 iTunes / iCloud 备份）；WebView 永远拿不到这把密钥，只拿到加解密结果。
/// - 加密：CryptoKit AES.GCM（12 字节随机 nonce），返回 iv = nonce、data = 密文 + 16 字节 tag（均 Base64），与 WebCrypto / 安卓格式一致。
/// - 明文只在内存中短暂存在，不写日志。
@objc(SecureKeysPlugin)
public class SecureKeysPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureKeysPlugin"
    public let jsName = "SecureKeys"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "encrypt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decrypt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
    ]

    private let service = "local.contentagent.app.securekeys"
    private let account = "master-v1"

    private func baseQuery() -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func loadKey() -> SymmetricKey? {
        var q = baseQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, d.count == 32 else { return nil }
        return SymmetricKey(data: d)
    }

    private func createKey() throws -> SymmetricKey {
        if let k = loadKey() { return k }
        let k = SymmetricKey(size: .bits256)
        var q = baseQuery()
        q[kSecValueData as String] = k.withUnsafeBytes { Data($0) }
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        q[kSecAttrSynchronizable as String] = kCFBooleanFalse
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw NSError(domain: "SecureKeys", code: Int(st), userInfo: [NSLocalizedDescriptionKey: "钥匙串写入失败（\(st)）"]) }
        return k
    }

    @objc func info(_ call: CAPPluginCall) {
        let create = call.getBool("create") ?? false
        var ret: [String: Any] = ["available": true, "securityLevel": "ios_keychain", "isInsideSecureHardware": false,
                                  "storageBackend": "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", "userAuthRequired": false]
        do {
            if create { _ = try createKey() }
            ret["hasKey"] = loadKey() != nil
        } catch {
            ret["error"] = error.localizedDescription
        }
        call.resolve(ret)
    }

    @objc func encrypt(_ call: CAPPluginCall) {
        guard let plain = call.getString("plaintext") else { call.reject("缺少 plaintext", "BAD_INPUT"); return }
        do {
            let k = try createKey()
            let box = try AES.GCM.seal(Data(plain.utf8), using: k, nonce: AES.GCM.Nonce())
            let nonce = box.nonce.withUnsafeBytes { Data($0) }
            call.resolve(["iv": nonce.base64EncodedString(), "data": (box.ciphertext + box.tag).base64EncodedString()])
        } catch {
            call.reject("加密失败：\(error.localizedDescription)", "ENCRYPT_FAILED")
        }
    }

    @objc func decrypt(_ call: CAPPluginCall) {
        guard let ivS = call.getString("iv"), let dataS = call.getString("data"), let iv = Data(base64Encoded: ivS), let data = Data(base64Encoded: dataS), data.count >= 16 else {
            call.reject("缺少 iv / data", "BAD_INPUT"); return
        }
        guard let k = loadKey() else { call.reject("钥匙串里没有对应的密钥（可能换过手机或重装过）", "NO_KEY"); return }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: data.prefix(data.count - 16), tag: data.suffix(16))
            let pt = try AES.GCM.open(box, using: k)
            call.resolve(["plaintext": String(decoding: pt, as: UTF8.self)])
        } catch {
            call.reject("密文与本机密钥不匹配", "BAD_TAG")
        }
    }

    @objc func reset(_ call: CAPPluginCall) {
        let st = SecItemDelete(baseQuery() as CFDictionary)
        if st == errSecSuccess || st == errSecItemNotFound { call.resolve(["ok": true]) } else { call.reject("删除密钥失败（\(st)）", "RESET_FAILED") }
    }
}
