const express      = require('express');
const router       = express.Router();
const Notification = require('../models/Notification');
const User         = require('../models/User');
const { requireAuth } = require('../utils/auth');

router.use(requireAuth);

// ── GET /notifications ────────────────────────────────────────────────────────
// Returns current user's notifications (admin can pass ?userId= to see another's)
router.get('/', async (req, res) => {
  try {
    const targetId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    const items = await Notification.findByUser(targetId);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /notifications/count ──────────────────────────────────────────────────
router.get('/count', async (req, res) => {
  try {
    const count = await Notification.unreadCount(req.user.id);
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /notifications/users ──────────────────────────────────────────────────
// Admin only — list all users for the "send tip" target dropdown
router.get('/users', async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  try {
    const users = await User.findAll();
    res.json(users.map(u => ({ id: u.id, displayName: u.displayName || u.username, username: u.username })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /notifications ───────────────────────────────────────────────────────
// Admin creates a tip/notification for one or more users
router.post('/', async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  try {
    const { userIds, title, message, candidateId = '', candidateName = '' } = req.body;
    if (!userIds?.length || !message?.trim()) {
      return res.status(400).json({ error: 'userIds and message are required' });
    }
    const created = await Promise.all(
      userIds.map(uid => Notification.create({
        userId: uid, type: 'tip',
        title: title?.trim() || 'Guide Tip from Admin',
        message: message.trim(),
        candidateId, candidateName,
        createdBy: req.user.id,
        createdByName: req.user.displayName || req.user.username,
      }))
    );
    res.json({ success: true, created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /notifications/sent ──────────────────────────────────────────────────
// Admin: returns all notifications sent by this admin, with per-recipient read status
router.get('/sent', async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  try {
    const all = await Notification.findAll();
    // Only notifications created by this admin
    const sent = all.filter(n => n.createdBy === req.user.id);

    // Group by a "send batch" key: same title+message+createdAt prefix (within 5s)
    // Simpler: just return flat list with userId + read, let frontend group by content
    const User = require('../models/User');
    const users = await User.findAll().catch(() => []);
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u.displayName || u.username; });

    res.json(sent.map(n => ({
      ...n,
      recipientName: userMap[n.userId] || n.userId,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    await Notification.markRead(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /notifications/read-all ────────────────────────────────────────────
router.patch('/read-all', async (req, res) => {
  try {
    await Notification.markAllRead(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /notifications/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Admin can delete any; users can only delete their own
    await Notification.delete(req.params.id, req.user.isAdmin ? null : req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
