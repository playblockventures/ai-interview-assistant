const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const { signToken, requireAuth, requireAdmin } = require('../utils/auth');
const { isConnected, getInitError } = require('../utils/firebase');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  // Step 1 — DB check
  if (!isConnected()) {
    return res.status(503).json({
      error: 'Database not connected.',
      detail: getInitError() || 'FIREBASE_SERVICE_ACCOUNT env var may be missing or invalid.',
      step: 'firebase_init',
    });
  }

  const { username, password } = req.body;

  // Step 2 — input check
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required', step: 'validation' });
  }

  // Step 3 — ensure admin exists (lazy, non-blocking)
  try {
    await User.ensureAdminExists();
  } catch (e) {
    console.error('[login] ensureAdminExists failed:', e.message);
    // Non-fatal — continue login attempt
  }

  // Step 4 — find user
  let user;
  try {
    user = await User.findByUsername(username);
  } catch (e) {
    console.error('[login] findByUsername failed:', e.message);
    return res.status(500).json({ error: 'Failed to query users: ' + e.message, step: 'find_user' });
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password', step: 'not_found' });
  }

  // Step 5 — verify password
  let valid;
  try {
    valid = await User.verifyPassword(user, password);
  } catch (e) {
    console.error('[login] verifyPassword failed:', e.message);
    return res.status(500).json({ error: 'Password verification failed: ' + e.message, step: 'verify_password' });
  }

  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password', step: 'wrong_password' });
  }

  // Step 6 — sign token
  try {
    const { passwordHash, ...safe } = user;
    const token = signToken({
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
      isAdmin:     user.isAdmin,
    });
    return res.json({ token, user: safe });
  } catch (e) {
    console.error('[login] signToken failed:', e.message);
    return res.status(500).json({ error: 'Token signing failed: ' + e.message, step: 'sign_token' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { passwordHash, ...safe } = user;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await User.verifyPassword(user, currentPassword);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    await User.updatePassword(req.user.id, newPassword);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/users (admin only)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    res.json(await User.findAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users (admin only)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { username, displayName, isAdmin } = req.body;
    res.status(201).json(await User.create({ username, displayName, isAdmin }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/auth/users/:id (admin only)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await User.delete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users/:id/reset-password (admin only)
router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    await User.updatePassword(req.params.id, req.body.newPassword || '12345678');
    res.json({ message: 'Password reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
