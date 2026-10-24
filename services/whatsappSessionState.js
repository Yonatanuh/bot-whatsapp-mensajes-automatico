const INITIALIZATION_TIMEOUT_MS = 5 * 60 * 1000;

function isStaleInitializingSession(session, now = Date.now()) {
  return Boolean(
    session &&
    session.status === "INITIALIZING" &&
    Number.isFinite(session.createdAt) &&
    now - session.createdAt >= INITIALIZATION_TIMEOUT_MS
  );
}

module.exports = { isStaleInitializingSession };
