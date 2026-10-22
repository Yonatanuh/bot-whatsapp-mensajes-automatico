const qrcode = require("qrcode");

function normalizeQrDataUrl(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("data:image/")) return "";

  const [header, payload] = trimmed.split(",");
  if (!header || !payload || !header.includes(";base64")) return "";

  const base64Payload = payload.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(base64Payload)) return "";

  return trimmed;
}

async function generateQrDataUrl(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    throw new Error("El contenido del QR es inválido.");
  }

  const normalized = normalizeQrDataUrl(rawValue);
  if (normalized) return normalized;

  const dataUrl = await qrcode.toDataURL(rawValue, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    type: "image/png"
  });

  return normalizeQrDataUrl(dataUrl) || dataUrl;
}

module.exports = {
  normalizeQrDataUrl,
  generateQrDataUrl
};
