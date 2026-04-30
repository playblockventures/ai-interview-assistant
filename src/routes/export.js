const express      = require('express');
const router       = express.Router();
const multer       = require('multer');
const Candidate    = require('../models/Candidate');
const KnowledgeBase = require('../models/KnowledgeBase');
const Settings     = require('../models/Settings');
const { requireAuth } = require('../utils/auth');
const { getDB }    = require('../utils/firebase');

router.use(requireAuth);

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// ── GET /export ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const scope = (req.query.scope === 'full' && req.user.isAdmin) ? 'full' : 'user';

    const customRoles = await Settings.get('custom_roles').catch(() => null) || [];
    let candidates = [], knowledge = [], companyScenario = '', recruiters = [], usersSettings = {};

    if (scope === 'user') {
      // Fetch all candidate IDs for this user, then load full docs
      const light = await Candidate.findAll({ ownerId: req.user.id, limit: 100000 });
      candidates = await Promise.all(light.candidates.map(c => Candidate.findById(c.id)));
      candidates = candidates.filter(Boolean);

      companyScenario = await Settings.getForUser(req.user.id, 'company_scenario').catch(() => '') || '';
      recruiters      = await Settings.getForUser(req.user.id, 'recruiters').catch(() => []) || [];
      knowledge       = await KnowledgeBase.findByUser(req.user.id);
    } else {
      // Admin full export — raw Firestore read for all candidates
      const snap = await getDB().collection('candidates').get();
      candidates = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      knowledge = await KnowledgeBase.findAll();

      // Collect all per-user settings
      const allSettings = await Settings.getAll().catch(() => ({}));
      const userIds = new Set();
      Object.keys(allSettings).forEach(k => {
        if (k.startsWith('company_scenario_')) userIds.add(k.replace('company_scenario_', ''));
        if (k.startsWith('recruiters_'))       userIds.add(k.replace('recruiters_', ''));
      });
      userIds.forEach(uid => {
        usersSettings[uid] = {
          companyScenario: allSettings[`company_scenario_${uid}`] || '',
          recruiters:      allSettings[`recruiters_${uid}`]       || [],
        };
      });
    }

    // Strip Firestore document IDs (new IDs are generated on import)
    const cleanCandidates = candidates.map(({ id: _id, ...c }) => c);
    const cleanKnowledge  = knowledge.map(({ id: _id, ...k })  => k);

    const payload = {
      version:    '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: {
        id:          req.user.id,
        username:    req.user.username,
        displayName: req.user.displayName || req.user.username,
      },
      scope,
      candidates:   cleanCandidates,
      customRoles,
      knowledge:    cleanKnowledge,
      ...(scope === 'user'
        ? { companyScenario, recruiters }
        : { usersSettings }),
    };

    const filename = `interviewai-${scope}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('[Export]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /export (import) ────────────────────────────────────────────────────
router.post('/', importUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    let data;
    try { data = JSON.parse(req.file.buffer.toString('utf-8')); }
    catch { return res.status(400).json({ error: 'Invalid JSON file' }); }

    if (!data.version || !Array.isArray(data.candidates)) {
      return res.status(400).json({ error: 'Unrecognised export file format' });
    }

    const mode         = req.query.mode === 'replace' ? 'replace' : 'merge';
    const isFullImport = data.scope === 'full' && req.user.isAdmin;
    const results      = { candidatesCreated: 0, knowledgeCreated: 0, settingsImported: false, errors: [] };

    // ── Replace mode: delete before importing ─────────────────────────────────
    if (mode === 'replace') {
      if (isFullImport) {
        // Admin replace-all: wipe every candidate and KB item
        const snap = await getDB().collection('candidates').get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));

        const kbSnap = await getDB().collection('knowledge_base').get();
        await Promise.all(kbSnap.docs.map(d => d.ref.delete()));
        const kbChunkSnap = await getDB().collection('knowledge_base_chunks').get();
        await Promise.all(kbChunkSnap.docs.map(d => d.ref.delete()));
      } else {
        // User replace: wipe only their own data
        const existing = await Candidate.findAll({ ownerId: req.user.id, limit: 100000 });
        await Promise.all(existing.candidates.map(c => Candidate.delete(c.id)));

        const existingKB = await KnowledgeBase.findByUser(req.user.id);
        await Promise.all(existingKB.map(k => KnowledgeBase.delete(k.id, req.user.id)));
      }
    }

    // ── Import candidates ─────────────────────────────────────────────────────
    for (const c of data.candidates) {
      try {
        await Candidate.create({
          ...c,
          ownerId:   isFullImport ? (c.ownerId   || req.user.id) : req.user.id,
          ownerName: isFullImport ? (c.ownerName || req.user.displayName || req.user.username) : (req.user.displayName || req.user.username),
        });
        results.candidatesCreated++;
      } catch (e) {
        results.errors.push(`Candidate "${c.fullName || '?'}": ${e.message}`);
      }
    }

    // ── Import knowledge base items ───────────────────────────────────────────
    for (const k of (data.knowledge || [])) {
      try {
        await KnowledgeBase.create({
          ...k,
          ownerId:   isFullImport ? (k.ownerId   || req.user.id) : req.user.id,
          ownerName: isFullImport ? (k.ownerName || req.user.displayName || req.user.username) : (req.user.displayName || req.user.username),
        });
        results.knowledgeCreated++;
      } catch (e) {
        results.errors.push(`Knowledge "${k.name || '?'}": ${e.message}`);
      }
    }

    // ── Import settings ───────────────────────────────────────────────────────
    if (isFullImport) {
      for (const [uid, s] of Object.entries(data.usersSettings || {})) {
        if (s.companyScenario) await Settings.setForUser(uid, 'company_scenario', s.companyScenario).catch(() => {});
        if (s.recruiters?.length) await Settings.setForUser(uid, 'recruiters', s.recruiters).catch(() => {});
      }
      if (data.customRoles?.length) await Settings.set('custom_roles', data.customRoles).catch(() => {});
    } else {
      if (data.companyScenario) await Settings.setForUser(req.user.id, 'company_scenario', data.companyScenario).catch(() => {});
      if (data.recruiters?.length) await Settings.setForUser(req.user.id, 'recruiters', data.recruiters).catch(() => {});
      if (data.customRoles?.length && req.user.isAdmin) await Settings.set('custom_roles', data.customRoles).catch(() => {});
    }
    results.settingsImported = true;

    res.json({ success: true, ...results });
  } catch (err) {
    console.error('[Import]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
