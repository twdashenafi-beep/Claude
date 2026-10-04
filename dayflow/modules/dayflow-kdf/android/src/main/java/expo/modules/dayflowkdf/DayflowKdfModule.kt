package expo.modules.dayflowkdf

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// PBKDF2-HMAC-SHA256, done by the platform rather than by Hermes.
//
// Written out over Mac instead of asking SecretKeyFactory for
// PBKDF2WithHmacSHA256, because that one takes the password as a char array
// and turns it into bytes itself — and which encoding it uses has differed
// between Android versions. The JavaScript side has already made the bytes
// with the encoder every platform must agree with; this only does arithmetic.
// Each HMAC is still BoringSSL underneath, through Conscrypt.
class DayflowKdfModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DayflowKdf")

    AsyncFunction("pbkdf2") { passwordHex: String, saltHex: String, iterations: Int, keyBytes: Int ->
      require(iterations > 0 && keyBytes > 0) { "bad parameters" }
      toHex(pbkdf2(fromHex(passwordHex), fromHex(saltHex), iterations, keyBytes))
    }
  }
}

private fun pbkdf2(password: ByteArray, salt: ByteArray, iterations: Int, keyBytes: Int): ByteArray {
  val mac = Mac.getInstance("HmacSHA256")
  // SecretKeySpec refuses an empty key. HMAC pads its key with zeros to the
  // block size anyway, so a single zero byte is the same key.
  mac.init(SecretKeySpec(if (password.isEmpty()) ByteArray(1) else password, "HmacSHA256"))
  val hLen = mac.macLength
  val out = ByteArray(keyBytes)
  var block = 1
  var offset = 0
  while (offset < keyBytes) {
    mac.update(salt)
    mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
    var u = mac.doFinal()
    val t = u.copyOf()
    for (i in 1 until iterations) {
      u = mac.doFinal(u)
      for (j in 0 until hLen) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
    }
    val n = minOf(hLen, keyBytes - offset)
    System.arraycopy(t, 0, out, offset, n)
    offset += n
    block++
  }
  return out
}

private fun fromHex(hex: String): ByteArray {
  require(hex.length % 2 == 0) { "not hex" }
  return ByteArray(hex.length / 2) { i ->
    val hi = Character.digit(hex[2 * i], 16)
    val lo = Character.digit(hex[2 * i + 1], 16)
    require(hi >= 0 && lo >= 0) { "not hex" }
    ((hi shl 4) or lo).toByte()
  }
}

private fun toHex(bytes: ByteArray): String =
  bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
