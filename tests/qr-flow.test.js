const test = require('node:test');
const assert = require('node:assert/strict');
const qrcode = require('qrcode');
const { normalizeQrDataUrl, generateQrDataUrl } = require('../services/qrService');

test('generateQrDataUrl returns a valid data URL for QR content', async () => {
  const output = await generateQrDataUrl('gateway-whatsapp-pagos-test');

  assert.match(output, /^data:image\/png;base64,/);

  const base64Payload = output.replace(/^data:image\/png;base64,/, '');
  assert.ok(base64Payload.length > 100);
  assert.doesNotThrow(() => Buffer.from(base64Payload, 'base64'));
});

test('normalizeQrDataUrl rejects malformed QR payloads', () => {
  assert.equal(normalizeQrDataUrl(''), '');
  assert.equal(normalizeQrDataUrl('plain-text'), '');
  assert.equal(normalizeQrDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('qrcode library produces a PNG payload for real WhatsApp QR data', async () => {
  const output = await qrcode.toDataURL('whatsapp-corporate-gateway');
  assert.match(output, /^data:image\/png;base64,/);
  const bytes = Buffer.from(output.replace(/^data:image\/png;base64,/, ''), 'base64');
  assert.ok(bytes.length > 512);
});
