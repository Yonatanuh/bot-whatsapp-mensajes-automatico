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

test('sanitizePhone preserves an international number country code', () => {
  assert.equal(sanitizePhone('+57 300 123 4567'), '573001234567');
  assert.equal(sanitizePhone('123'), '123');
});
