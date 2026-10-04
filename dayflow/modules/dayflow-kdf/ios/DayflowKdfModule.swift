import CommonCrypto
import ExpoModulesCore

// PBKDF2-HMAC-SHA256, done by the system rather than by Hermes.
//
// Bytes in, bytes out, both as hex. The JavaScript side has already turned the
// password into UTF-8 with its own encoder, and that encoder is the one every
// platform has to agree with — so nothing here gets to decide how a character
// becomes a byte. It is handed the bytes and only does the arithmetic.
public class DayflowKdfModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayflowKdf")

    // Async, so it runs off the JavaScript thread and the unlock screen keeps
    // drawing while the key is derived.
    AsyncFunction("pbkdf2") { (passwordHex: String, saltHex: String, iterations: Int, keyBytes: Int) throws -> String in
      guard let password = bytes(fromHex: passwordHex), let salt = bytes(fromHex: saltHex) else {
        throw KdfException("not hex")
      }
      guard iterations > 0, iterations <= Int(UInt32.max), keyBytes > 0 else {
        throw KdfException("bad parameters")
      }

      var derived = [UInt8](repeating: 0, count: keyBytes)
      let status = password.withUnsafeBytes { pw in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          pw.bindMemory(to: Int8.self).baseAddress, password.count,
          salt, salt.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
          UInt32(iterations),
          &derived, keyBytes
        )
      }
      guard status == kCCSuccess else {
        throw KdfException("CommonCrypto status \(status)")
      }
      return derived.map { String(format: "%02x", $0) }.joined()
    }
  }
}

private func bytes(fromHex hex: String) -> [UInt8]? {
  let chars = Array(hex.utf8)
  guard chars.count % 2 == 0 else { return nil }
  var out = [UInt8]()
  out.reserveCapacity(chars.count / 2)
  var i = 0
  while i < chars.count {
    guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
    out.append(hi << 4 | lo)
    i += 2
  }
  return out
}

private func nibble(_ c: UInt8) -> UInt8? {
  switch c {
  case 0x30...0x39: return c - 0x30
  case 0x61...0x66: return c - 0x61 + 10
  case 0x41...0x46: return c - 0x41 + 10
  default: return nil
  }
}

private final class KdfException: GenericException<String> {
  override var reason: String { "PBKDF2 failed: \(param)" }
}
