const crypto = require("crypto");

// Clave criptográfica de 256 bits (32 bytes)
const MASTER_SECRET = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!MASTER_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("CRITICAL: DATA_ENCRYPTION_KEY o JWT_SECRET no están definidos. Cifrado en producción requiere una clave segura.");
    process.exit(1);
  } else {
    console.warn("⚠️ [CRYPTO] Usando clave temporal para entorno de desarrollo. Configure DATA_ENCRYPTION_KEY para producción.");
  }
}
const SECRET_TO_USE = MASTER_SECRET || "dev_local_encryption_key_not_for_prod_123";
const SALT = "neobanco_data_at_rest_salt_v1";
const KEY = crypto.scryptSync(SECRET_TO_USE, SALT, 32);
const ALGORITHM = "aes-256-gcm";

/**
 * Encripta un campo de texto sensible en reposo usando AES-256-GCM
 * @param {string} text - Texto plano a encriptar
 * @returns {string} Texto cifrado con IV y AuthTag
 */
function encryptField(text) {
  if (text === null || text === undefined || text === "") return text;
  const str = text.toString();
  // Evitar re-encriptar si ya está cifrado
  if (str.startsWith("enc:v1:")) return str;

  try {
    const iv = crypto.randomBytes(12); // 96-bit IV recomendado para GCM
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(str, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `enc:v1:${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("⚠️ Error encriptando campo sensible:", err.message);
    return str;
  }
}

/**
 * Desencripta un campo de texto en reposo
 * @param {string} cipherText - Texto cifrado con formato enc:v1:iv:authTag:content
 * @returns {string} Texto plano original
 */
function decryptField(cipherText) {
  if (!cipherText || typeof cipherText !== "string") return cipherText;
  if (!cipherText.startsWith("enc:v1:")) return cipherText; // Formato plano retrocompatible

  try {
    const parts = cipherText.split(":");
    if (parts.length < 5) return cipherText;
    const iv = Buffer.from(parts[2], "hex");
    const authTag = Buffer.from(parts[3], "hex");
    const encryptedHex = parts.slice(4).join(":");

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("⚠️ Error desencriptando campo sensible:", err.message);
    return "[Dato Protegido Cifrado]";
  }
}

module.exports = {
  encryptField,
  decryptField
};
