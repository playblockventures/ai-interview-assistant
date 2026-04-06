const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const axios    = require('axios');
const cheerio  = require('cheerio');
const { isConnected } = require('../utils/firebase');
const { requireAuth, verifyToken } = require('../utils/auth');

const getSettings = () => require('../models/Settings');
const getKB       = () => require('../models/KnowledgeBase');
const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const { extractTextFromBuffer } = require('../utils/fileParser');

const recruiterKey = (userId) => `recruiters_${userId}`;

// ── GET /api/settings ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let hasFirebase     = !!process.env.FIREBASE_SERVICE_ACCOUNT;
    let roles           = null;
    let recruiters      = [];
    let companyScenario = '';
    let hasOpenAI       = !!process.env.OPENAI_API_KEY;
    let userOpenAIKey   = '';

    if (isConnected()) {
      const S   = getSettings();
      const all = await S.getAll().catch(() => ({}));

      if (all.firebase_service_account) hasFirebase = true;
      if (all.openai_api_key)           hasOpenAI   = true;
      if (all.custom_roles)             roles       = all.custom_roles;

      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        try {
          const payload = verifyToken(authHeader.slice(7));
          if (payload) {
            const userId = (payload.isAdmin && req.query.userId)
              ? req.query.userId
              : payload.id;

            const ownKey = await S.getForUser(userId, 'openai_key').catch(() => null);
            userOpenAIKey   = ownKey ? '••••••••' : '';
            if (ownKey) hasOpenAI = true;

            companyScenario = await S.getForUser(userId, 'company_scenario').catch(() => '') || '';

            if (payload.isAdmin) {
              // Admin sees ALL users' recruiters merged
              const allRecruiterKeys = Object.keys(all).filter(k => k.startsWith('recruiters_'));
              const merged = [];
              const seen   = new Set();
              allRecruiterKeys.forEach(k => {
                (all[k] || []).forEach(r => {
                  if (!seen.has(r.id)) {
                    seen.add(r.id);
                    merged.push({ ...r, _ownerKey: k });
                  }
                });
              });
              recruiters = merged;
            } else {
              recruiters = all[recruiterKey(userId)] || [];
            }
          }
        } catch (_) {}
      }
    }

    res.json({ hasOpenAI, hasFirebase, userOpenAIKey, dbConnected: isConnected(), roles, recruiters, companyScenario });
  } catch (err) {
    res.json({ hasOpenAI: !!process.env.OPENAI_API_KEY, hasFirebase: !!process.env.FIREBASE_SERVICE_ACCOUNT, dbConnected: false, roles: null, recruiters: [], companyScenario: '', userOpenAIKey: '' });
  }
});

// ── PUT /api/settings/openai-key ──────────────────────────────────────────────
router.put('/openai-key', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid API key — must start with sk-' });
    }
    await getSettings().setForUser(req.user.id, 'openai_key', apiKey.trim());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/settings/openai-key ──────────────────────────────────────────
router.delete('/openai-key', requireAuth, async (req, res) => {
  try {
    await getSettings().setForUser(req.user.id, 'openai_key', null);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/company-scenario ───────────────────────────────────────
router.put('/company-scenario', requireAuth, async (req, res) => {
  try {
    await getSettings().setForUser(req.user.id, 'company_scenario', req.body.scenario || '');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/recruiters ─────────────────────────────────────────────
router.put('/recruiters', requireAuth, async (req, res) => {
  try {
    await getSettings().set(recruiterKey(req.user.id), req.body.recruiters || []);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/settings/knowledge/list ─────────────────────────────────────────
router.get('/knowledge/list', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json([]);
  try {
    const targetId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    const items = await getKB().findByUser(targetId);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/file ────────────────────────────────────────
router.post('/knowledge/file', requireAuth, upload.single('file'), async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { category = 'company_docs' } = req.body;
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    const item = await getKB().create({
      name: req.file.originalname, type: 'file', content: text,
      fileName: req.file.originalname, category,
      ownerId: req.user.id, ownerName: req.user.displayName || req.user.username,
    });
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/url ─────────────────────────────────────────
router.post('/knowledge/url', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { url, category = 'company_docs' } = req.body;
    let text = '', siteName = '';
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InterviewAI/1.0)' },
    });
    const $ = cheerio.load(response.data);
    $('script,style,nav,footer,header,aside,iframe,noscript').remove();
    siteName = $('title').text().trim() || new URL(url).hostname;
    text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000);
    const item = await getKB().create({
      name: siteName, type: 'url', content: text, url, category,
      ownerId: req.user.id, ownerName: req.user.displayName || req.user.username,
    });
    res.json({ ...item, charCount: text.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/instructions ─────────────────────────────────
router.post('/knowledge/instructions', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { content, name = 'Custom Instructions' } = req.body;
    const item = await getKB().create({
      name, type: 'custom_instructions', content,
      category: 'instructions',
      ownerId: req.user.id, ownerName: req.user.displayName || req.user.username,
    });
    await getSettings().setForUser(req.user.id, 'custom_instructions', content);
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/test-instructions ───────────────────────────
router.post('/knowledge/test-instructions', requireAuth, async (req, res) => {
  try {
    const { getOpenAIClient, buildSystemContext } = require('../utils/openai');
    const { instructions, prompt = 'What do you know about this company? Summarise the key information.' } = req.body;
    const kbContext = await buildSystemContext(req.user.id);
    const systemPrompt = [
      kbContext || '(No knowledge base uploaded yet)',
      instructions ? `\n\n--- ADDITIONAL INSTRUCTIONS ---\n${instructions}` : '',
    ].join('');
    const openai = await getOpenAIClient(req.user.id);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: prompt },
      ],
      max_tokens: 600, temperature: 0.7,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/settings/knowledge/:id ───────────────────────────────────────
router.delete('/knowledge/:id', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    await getKB().delete(req.params.id, req.user.isAdmin ? null : req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/:key — global settings ──────────────────────────────────
router.put('/:key', async (req, res) => {
  const { value } = req.body;
  const { key }   = req.params;
  if (key === 'firebase_service_account' && value) {
    try {
      const ok = req.app.locals.initFirebase(value);
      if (!ok) return res.status(400).json({ error: 'Could not initialize Firebase.' });
      return res.json({ success: true, key, dbConnected: true });
    } catch (e) {
      return res.status(400).json({ error: `Firebase initialization failed: ${e.message}` });
    }
  }
  if (isConnected()) {
    try { await getSettings().set(key, value); } catch (_) {}
  }
  res.json({ success: true, key, dbConnected: isConnected() });
});

module.exports = router;
module.exports.memStore = {};
