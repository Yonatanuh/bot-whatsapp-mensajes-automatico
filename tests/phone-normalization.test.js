const test = require('node:test');
const assert = require('node:assert/strict');

function sanitizePhone(phone) {
  if (!phone) return "";
  let cleanNumber = phone.toString().replace(/\D/g, "");
  if (cleanNumber.startsWith("00")) {
    cleanNumber = cleanNumber.substring(2);
  }
  // Normalizar números de República Dominicana de 10 dígitos (809/829/849) agregando el código 1
  if (cleanNumber.length === 10 && /^(809|829|849)/.test(cleanNumber)) {
    cleanNumber = "1" + cleanNumber;
  }
  return cleanNumber;
}

function getFallbackJid(cleanNumber) {
  if (cleanNumber && /^\d{10,15}$/.test(cleanNumber)) {
    return `${cleanNumber}@c.us`;
  }
  return null;
}

test('sanitizePhone normalizes Dominican local numbers with area code 809/829/849', () => {
  assert.equal(sanitizePhone('8095550103'), '18095550103');
  assert.equal(sanitizePhone('8295550104'), '18295550104');
  assert.equal(sanitizePhone('8495550105'), '18495550105');
});

test('sanitizePhone handles numbers with + and punctuation', () => {
  assert.equal(sanitizePhone('+1 (809) 555-0103'), '18095550103');
  assert.equal(sanitizePhone('+1-829-555-0104'), '18295550104');
  assert.equal(sanitizePhone('0018095550103'), '18095550103');
});

test('getFallbackJid produces valid @c.us for 10-15 digit numbers', () => {
  const dominican = sanitizePhone('8095550103');
  assert.equal(getFallbackJid(dominican), '18095550103@c.us');

  const intl = sanitizePhone('573001234567');
  assert.equal(getFallbackJid(intl), '573001234567@c.us');

  assert.equal(getFallbackJid('123'), null);
});

