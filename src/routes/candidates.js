const express      = require('express');
const router       = express.Router();
const multer       = require('multer');
const Candidate    = require('../models/Candidate');
const User         = require('../models/User');
const Notification = require('../models/Notification');
const { extractTextFromBuffer } = require('../utils/fileParser');
const { requireAuth } = require('../utils/auth');

// Memory storage — no disk writes, works on Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (['.pdf','.doc','.docx','.txt'].some(e => name.endsWith(e))) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, TXT files are allowed'));
  },
});

// Permissive upload for conversation attachments — accepts any file type
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(requireAuth);

// GET analytics — server-computed aggregations for dashboard overview
router.get('/analytics', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const result = await Candidate.computeAnalytics({
      ownerId: req.user.isAdmin ? null : req.user.id,
      isAdmin: req.user.isAdmin,
      fromDate, toDate,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET stats — lightweight aggregate for dashboard (no large fields)
router.get('/stats', async (req, res) => {
  try {
    const docs = await Candidate.getStats({
      ownerId: req.user.isAdmin ? null : req.user.id,
      isAdmin: req.user.isAdmin,
    });
    res.json({ candidates: docs, total: docs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET active with avg response time — for dashboard
router.get('/active-response', async (req, res) => {
  try {
    const docs = await Candidate.findActiveWithResponseTime({
      ownerId: req.user.isAdmin ? null : req.user.id,
      isAdmin: req.user.isAdmin,
      limit: req.query.limit || 20,
    });
    res.json({ candidates: docs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET recent — small list for dashboard recent activity
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const docs = await Candidate.findRecent({
      ownerId: req.user.isAdmin ? null : req.user.id,
      isAdmin: req.user.isAdmin,
      limit,
    });
    res.json({ candidates: docs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET check-dangerous — unscoped, checks if email/linkedinUrl matches any dangerous candidate
router.get('/check-dangerous', async (req, res) => {
  try {
    const { email, linkedinUrl } = req.query;
    const match = await Candidate.checkDangerous({ email, linkedinUrl });
    res.json({ dangerous: !!match, candidate: match || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET all — scoped by user unless admin
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20, recruiterId, ownerId: ownerIdParam, ids, excludeIds, fromDate, toDate } = req.query;
    const result = await Candidate.findAll({
      status, search, page, limit, recruiterId, fromDate, toDate,
      ownerId: req.user.isAdmin ? (ownerIdParam || null) : req.user.id,
      isAdmin: req.user.isAdmin,
      ids:        ids        ? ids.split(',').filter(Boolean)        : undefined,
      excludeIds: excludeIds ? excludeIds.split(',').filter(Boolean) : undefined,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (!Candidate.canAccess(candidate, req.user)) return res.status(403).json({ error: 'Access denied' });
    res.json(candidate);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', upload.single('resume'), async (req, res) => {
  try {
    const { fullName, email, linkedinUrl, phone, location, currentTitle, photoUrl,
            role, resumeUrl, recruiterId, recruiterName, companyId, companyName,
            resumeText: bodyText, linkedinProfile: linkedinProfileRaw } = req.body;

    let resumeText = bodyText || '', resumeFileName = '';
    if (req.file) {
      resumeText     = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
      resumeFileName = req.file.originalname;
    }

    let linkedinProfile = null;
    try { if (linkedinProfileRaw) linkedinProfile = JSON.parse(linkedinProfileRaw); } catch (_) {}

    const candidate = await Candidate.create({
      fullName, email, linkedinUrl, phone, location, currentTitle,
      photoUrl:        photoUrl        || '',
      role, resumeText, resumeFileName,
      resumeUrl:       resumeUrl       || '',
      recruiterId:     recruiterId     || '',
      recruiterName:   recruiterName   || '',
      companyId:       companyId       || '',
      companyName:     companyName     || '',
      linkedinProfile: linkedinProfile || null,
      ownerId:         req.user.id,
      ownerName:       req.user.displayName || req.user.username,
    });
    res.status(201).json(candidate);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update
router.put('/:id', upload.single('resume'), async (req, res) => {
  try {
    const existing = await Candidate.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Candidate not found' });
    if (!Candidate.canAccess(existing, req.user)) return res.status(403).json({ error: 'Access denied' });
    const updates = { ...req.body };
    if (req.file) {
      updates.resumeText     = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
      updates.resumeFileName = req.file.originalname;
    }
    if (updates.linkedinProfile) {
      try { updates.linkedinProfile = JSON.parse(updates.linkedinProfile); } catch (_) { delete updates.linkedinProfile; }
    }
    res.json(await Candidate.update(req.params.id, updates));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH status
router.patch('/:id/status', async (req, res) => {
  try {
    const existing = await Candidate.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Candidate not found' });
    if (!Candidate.canAccess(existing, req.user)) return res.status(403).json({ error: 'Access denied' });
    const { status, notes } = req.body;
    const updated = await Candidate.update(req.params.id, { status, notes: notes ?? '' });

    // Fire-and-forget notifications — don't block the response
    if (status !== existing.status) {
      (async () => {
        try {
          const allUsers = await User.findAll();
          const updaterName = req.user.displayName || req.user.username;
          const candidateName = existing.fullName || 'A candidate';
          const candidateId = req.params.id;

          const STATUS_LABEL = {
            pending: 'Pending', in_progress: 'In Progress', success: 'Success',
            no_response: 'No Response', not_interested: 'Not Interested',
            other_job: 'Already Occupied', have_a_doubt: 'Have a Doubt', failed: 'Failed', dangerous: 'Dangerous',
          };
          const statusLabel = STATUS_LABEL[status] || status;

          const notifs = [];

          // Admins get notified of every status change (by anyone, except themselves)
          allUsers
            .filter(u => u.isAdmin && u.id !== req.user.id)
            .forEach(u => notifs.push(Notification.create({
              userId: u.id,
              type: status === 'success' ? 'success' : 'status_update',
              title: status === 'success' ? '🎉 Interview Success!' : '📋 Status Update',
              message: status === 'success'
                ? `${candidateName} was marked as hired by ${updaterName}`
                : `${candidateName}'s status changed to "${statusLabel}" by ${updaterName}`,
              candidateId,
              candidateName,
              createdBy: req.user.id,
              createdByName: updaterName,
            })));

          // On success: also notify all non-admin users (except the updater)
          if (status === 'success') {
            allUsers
              .filter(u => !u.isAdmin && u.id !== req.user.id)
              .forEach(u => notifs.push(Notification.create({
                userId: u.id,
                type: 'success',
                title: '🎉 Interview Success!',
                message: `${candidateName} was marked as hired by ${updaterName}`,
                candidateId,
                candidateName,
                createdBy: req.user.id,
                createdByName: updaterName,
              })));
          }

          await Promise.all(notifs);
        } catch (_) {}
      })();
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const existing = await Candidate.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Candidate not found' });
    if (!Candidate.canAccess(existing, req.user)) return res.status(403).json({ error: 'Access denied' });
    await Candidate.delete(req.params.id);
    res.json({ message: 'Candidate deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST backfill-last-message — admin only, one-time fix for missing lastMessageAt
router.post('/backfill-last-message', async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    const count = await Candidate.backfillLastMessageAt();
    res.json({ message: `Backfilled lastMessageAt for ${count} candidates.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST parse-attachment — extract text from any file (for conversation attachments)
router.post('/parse-attachment', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    res.json({ text, filename: req.file.originalname });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST bulk-reassign-owner — admin only, moves selected candidates to another user
router.post('/bulk-reassign-owner', async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    const { candidateIds, toUserId } = req.body;
    if (!Array.isArray(candidateIds) || !candidateIds.length || !toUserId)
      return res.status(400).json({ error: 'candidateIds (array) and toUserId required' });
    const targetUser = await User.findById(toUserId).catch(() => null);
    const toOwnerName = targetUser?.displayName || targetUser?.username || '';
    const count = await Candidate.reassignOwnerBulk(candidateIds, toUserId, toOwnerName);
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST reassign-owner — admin only, transfers candidates from one user to another for a recruiter
router.post('/reassign-owner', async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    const { fromUserId, toUserId, recruiterId } = req.body;
    if (!fromUserId || !toUserId || !recruiterId) return res.status(400).json({ error: 'fromUserId, toUserId, recruiterId required' });
    const targetUser = await User.findById(toUserId).catch(() => null);
    const toOwnerName = targetUser?.displayName || targetUser?.username || '';
    const count = await Candidate.reassignOwner(fromUserId, toUserId, recruiterId, toOwnerName);
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
