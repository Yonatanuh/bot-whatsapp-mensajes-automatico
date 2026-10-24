const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveRegisteredNumberId,
  sendWhatsAppMessage
} = require('../services/whatsappMessaging');

test('resolveRegisteredNumberId only returns a number verified by WhatsApp', async () => {
  const queriedNumbers = [];
  const client = {
    async getNumberId(number) {
      queriedNumbers.push(number);
      return null;
    }
  };

  const result = await resolveRegisteredNumberId(client, '18095550103');

  assert.equal(result, null);
  assert.deepEqual(queriedNumbers, ['18095550103', '8095550103']);
});

test('resolveRegisteredNumberId returns the WhatsApp ID for an alternate supported format', async () => {
  const expected = { _serialized: '5215512345678@c.us' };
  const queriedNumbers = [];
  const client = {
    async getNumberId(number) {
      queriedNumbers.push(number);
      return number === '5215512345678' ? expected : null;
    }
  };

  const result = await resolveRegisteredNumberId(client, '525512345678');

  assert.equal(result, expected);
  assert.deepEqual(queriedNumbers, ['525512345678', '5215512345678']);
});

test('resolveRegisteredNumberId propagates lookup failures instead of bypassing verification', async () => {
  const client = {
    async getNumberId() {
      throw new Error('number lookup failed');
    }
  };

  await assert.rejects(
    resolveRegisteredNumberId(client, '18095550103'),
    /number lookup failed/
  );
});

test('sendWhatsAppMessage waits for WhatsApp send confirmation', async () => {
  const expected = { id: 'message-id' };
  let receivedArguments;
  const client = {
    async sendMessage(...args) {
      receivedArguments = args;
      return expected;
    }
  };

  const result = await sendWhatsAppMessage(client, '18095550103@c.us', 'Hola');

  assert.equal(result, expected);
  assert.deepEqual(receivedArguments, [
    '18095550103@c.us',
    'Hola',
    { waitUntilMsgSent: true }
  ]);
});

test('sendWhatsAppMessage reports when WhatsApp does not return a sent message', async () => {
  const client = {
    async sendMessage() {
      return undefined;
    }
  };

  await assert.rejects(
    sendWhatsAppMessage(client, '18095550103@c.us', 'Hola'),
    /WhatsApp no confirmó el envío/
  );
});

test('sendWhatsAppMessage propagates WhatsApp send errors', async () => {
  const client = {
    async sendMessage() {
      throw new Error('connection lost');
    }
  };

  await assert.rejects(
    sendWhatsAppMessage(client, '18095550103@c.us', 'Hola'),
    /connection lost/
  );
});
