require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const { initFirebase, isConnected, getInitError } = require('../src/utils/firebase');
const authRoutes      = require('../src/routes/auth');
const candidateRoutes = require('../src/routes/candidates');
const interviewRoutes = require('../src/routes/interviews');
const settingsRoutes  = require('../src/routes/settings');
const generateRoutes  = require('../src/routes/generate');
const extractRoutes   = require('../src/routes/extract');
const exportRoutes         = require('../src/routes/export');
const notificationRoutes   = require('../src/routes/notifications');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Firebase ───────────────────────────────────────────────────────────────────
initFirebase();

// One-time backfill: set lastMessageAt from outreach messages for legacy candidates
setImmediate(async () => {
  if (!isConnected()) return;
  try {
    const Candidate = require('../src/models/Candidate');
    const count = await Candidate.backfillLastMessageAt();
    if (count > 0) console.log(`[startup] Backfilled lastMessageAt for ${count} candidates`);
  } catch (e) { /* non-critical — fail silently */ }
});

const requireDB = (req, res, next) => {
  if (!isConnected()) {
    return res.status(503).json({
      error:  'Database not connected.',
      reason: getInitError() || 'FIREBASE_SERVICE_ACCOUNT env var missing or invalid.',
    });
  }
  next();
};

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',               authRoutes);
app.use('/api/candidates/extract', extractRoutes);
app.use('/api/candidates',         requireDB, candidateRoutes);
app.use('/api/interviews',         requireDB, interviewRoutes);
app.use('/api/settings',           settingsRoutes);
app.use('/api/generate',           requireDB, generateRoutes);
app.use('/api/export',             requireDB, exportRoutes);
app.use('/api/notifications',      requireDB, notificationRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const connected = isConnected();
  res.status(connected ? 200 : 503).json({
    status:    connected ? 'ok' : 'error',
    db:        connected ? 'connected' : 'disconnected',
    dbError:   connected ? null : (getInitError() || 'Unknown'),
    envVarSet: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    ts:        new Date().toISOString(),
  });
});

// ── Setup — creates default admin (call once after first deploy) ───────────────
app.get('/api/setup', async (req, res) => {
  if (!isConnected()) {
    return res.status(503).json({
      error:  'Database not connected.',
      reason: getInitError(),
    });
  }
  try {
    const User = require('../src/models/User');
    await User.ensureAdminExists();
    res.json({
      success:     true,
      credentials: { username: 'admin', password: '12345678' },
      next:        'Login then change your password in Settings → Account.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 404 + Error ────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Local dev only ─────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, async () => {
    console.log(`🚀 Server on http://localhost:${PORT}`);
    if (isConnected()) {
      try { await require('../src/models/User').ensureAdminExists(); }
      catch (e) { console.error('[Auth]', e.message); }
    }
  });
}

module.exports = app;
