const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const Candidate = require('../models/Candidate');
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

// GET all — scoped by user unless admin
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20, recruiterId, ownerId: ownerIdParam, ids } = req.query;
    const result = await Candidate.findAll({
      status, search, page, limit, recruiterId,
      ownerId: req.user.isAdmin ? (ownerIdParam || null) : req.user.id,
      isAdmin: req.user.isAdmin,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
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
            resumeText: bodyText } = req.body;

    let resumeText = bodyText || '', resumeFileName = '';
    if (req.file) {
      resumeText     = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
      resumeFileName = req.file.originalname;
    }

    const candidate = await Candidate.create({
      fullName, email, linkedinUrl, phone, location, currentTitle,
      photoUrl:      photoUrl      || '',
      role, resumeText, resumeFileName,
      resumeUrl:     resumeUrl     || '',
      recruiterId:   recruiterId   || '',
      recruiterName: recruiterName || '',
      companyId:     companyId     || '',
      companyName:   companyName   || '',
      ownerId:       req.user.id,
      ownerName:     req.user.displayName || req.user.username,
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
    res.json(await Candidate.update(req.params.id, { status, notes: notes ?? '' }));
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

// POST reassign-owner — admin only, transfers candidates from one user to another for a recruiter
router.post('/reassign-owner', async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    const { fromUserId, toUserId, recruiterId } = req.body;
    if (!fromUserId || !toUserId || !recruiterId) return res.status(400).json({ error: 'fromUserId, toUserId, recruiterId required' });
    const count = await Candidate.reassignOwner(fromUserId, toUserId, recruiterId);
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
