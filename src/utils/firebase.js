const admin = require('firebase-admin');

let db          = null;
let initialized = false;
let initError   = null;

const initFirebase = (serviceAccount) => {
  try {
    if (initialized) {
      try { admin.app().delete(); } catch (_) {}
      initialized = false;
      db = null;
      initError = null;
    }

    let credential;

    if (serviceAccount) {
      // Called from Settings UI with a JSON object or string
      const parsed = typeof serviceAccount === 'string'
        ? JSON.parse(serviceAccount)
        : serviceAccount;
      credential = admin.credential.cert(parsed);

    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Env var — handle common formatting issues:
      // 1. The private_key field has literal \n that must become real newlines
      // 2. The JSON may have been double-escaped by some deployment tools
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();

      // Remove surrounding single quotes if present (common shell mistake)
      if (raw.startsWith("'") && raw.endsWith("'")) {
        raw = raw.slice(1, -1);
      }

      const parsed = JSON.parse(raw);

      // Restore real newlines in the private key if they were escaped as \n
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }

      credential = admin.credential.cert(parsed);

    } else {
      initError = 'FIREBASE_SERVICE_ACCOUNT environment variable is not set.';
      console.warn('[Firebase]', initError);
      return false;
    }

    admin.initializeApp({ credential });
    db          = admin.firestore();
    initialized = true;
    initError   = null;
    console.log('[Firebase] Firestore connected ✓');
    return true;

  } catch (err) {
    initError = err.message;
    console.error('[Firebase] Init error:', err.message);
    return false;
  }
};

const getDB        = () => db;
const isConnected  = () => initialized && db !== null;
const getInitError = () => initError;

// Auto-init from env var on module load
initFirebase();

module.exports = { initFirebase, getDB, isConnected, getInitError };
