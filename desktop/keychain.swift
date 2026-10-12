import Foundation
import Security

// Secrets travel over stdin/stdout, never command arguments or files.
let args = CommandLine.arguments
guard args.count == 4, ["openai", "claude", "app-store-connect"].contains(args[3]) else { exit(2) }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: args[2], kSecAttrAccount as String: args[3]]
var status: OSStatus = errSecParam
switch args[1] {
case "read":
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    status = SecItemCopyMatching(read as CFDictionary, &value)
    if status == errSecSuccess, let data = value as? Data { FileHandle.standardOutput.write(data) }
    if status == errSecItemNotFound { exit(0) }
case "write":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count <= 4096 else { exit(2) }
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        status = SecItemAdd(add as CFDictionary, nil)
    }
case "delete":
    status = SecItemDelete(query as CFDictionary)
    if status == errSecItemNotFound { exit(0) }
default: exit(2)
}
if status != errSecSuccess {
    FileHandle.standardError.write(Data("Keychain operation failed (\(status)).".utf8))
    exit(1)
}
