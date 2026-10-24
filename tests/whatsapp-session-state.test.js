const test = require('node:test');
const assert = require('node:assert/strict');
const { isStaleInitializingSession } = require('../services/whatsappSessionState');

test('initializing session becomes stale after five minutes', () => {
  const createdAt = 1_000_000;

  assert.equal(
    isStaleInitializingSession(
      { status: 'INITIALIZING', createdAt },
      createdAt + 5 * 60 * 1000
    ),
    true
  );
});

test('recent initialization and non-initializing states are not stale', () => {
  const createdAt = 1_000_000;

  assert.equal(
    isStaleInitializingSession(
      { status: 'INITIALIZING', createdAt },
      createdAt + 30_000
    ),
    false
  );
  assert.equal(
    isStaleInitializingSession(
      { status: 'QR_READY', createdAt },
      createdAt + 10 * 60 * 1000
    ),
    false
  );
});

test('invalid session timestamps do not trigger stale-session recovery', () => {
  assert.equal(
    isStaleInitializingSession({ status: 'INITIALIZING', createdAt: NaN }),
    false
  );
});
