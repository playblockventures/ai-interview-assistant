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
const companiesKey = (userId) => `companies_${userId}`;

// In-memory settings cache — avoids hitting Firestore on every page load
// Cache is per-user and expires after 60 seconds
const settingsCache = new Map();
const SETTINGS_TTL = 60_000; // ms
const getCached = (key) => {
  const entry = settingsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SETTINGS_TTL) { settingsCache.delete(key); return null; }
  return entry.data;
};
const setCached = (key, data) => settingsCache.set(key, { data, ts: Date.now() });
const invalidateCache = (userId) => {
  settingsCache.delete(userId);
  settingsCache.delete('admin');
};

// ── GET /api/settings ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let hasFirebase         = !!process.env.FIREBASE_SERVICE_ACCOUNT;
    let roles               = null;
    let recruiters          = [];
    let companies           = [];
    let companyScenario     = '';
    let companyScenarios    = {};
    let hasOpenAI           = !!process.env.OPENAI_API_KEY;
    let userOpenAIKey       = '';
    let userEnhancvKey      = '';

    if (isConnected()) {
      const S   = getSettings();

      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        try {
          const payload = verifyToken(authHeader.slice(7));
          if (payload) {
            const userId = (payload.isAdmin && req.query.userId)
              ? req.query.userId
              : payload.id;

            // Check cache first
            const cacheKey = payload.isAdmin ? 'admin' : userId;
            const cached = getCached(cacheKey);
            if (cached) return res.json(cached);

            const all = await S.getAll().catch(() => ({}));

            if (all.firebase_service_account) hasFirebase = true;
            if (all.openai_api_key)           hasOpenAI   = true;
            if (all.custom_roles)             roles       = all.custom_roles;

            const ownKey = await S.getForUser(userId, 'openai_key').catch(() => null);
            userOpenAIKey   = ownKey ? '••••••••' : '';
            if (ownKey) hasOpenAI = true;

            const enhancvKey = await S.getForUser(userId, 'enhancv_key').catch(() => null);
            userEnhancvKey   = enhancvKey ? '••••••••' : '';

            companyScenario  = await S.getForUser(userId, 'company_scenario').catch(() => '') || '';
            const rawScenarios = await S.getForUser(userId, 'company_scenarios').catch(() => null) || {};
            // Translate '_default' back to '' for the client (Firestore rejects empty-string keys)
            companyScenarios = {};
            for (const [k, v] of Object.entries(rawScenarios)) {
              companyScenarios[k === '_default' ? '' : k] = v;
            }
            companies = all[companiesKey(userId)] || [];

            if (payload.isAdmin) {
              // Admin sees ALL users' companies merged (deduplicated by id)
              const allCompanyKeys = Object.keys(all).filter(k => k.startsWith('companies_'));
              const mergedCompanies = [];
              const seenCompanies = new Set();
              allCompanyKeys.forEach(k => {
                (all[k] || []).forEach(c => {
                  if (!seenCompanies.has(c.id)) {
                    seenCompanies.add(c.id);
                    mergedCompanies.push(c);
                  }
                });
              });
              if (mergedCompanies.length > 0) companies = mergedCompanies;

              // Admin sees ALL users' recruiters merged, with owner info attached
              const User = require('../models/User');
              const users = await User.findAll().catch(() => []);
              const userMap = {};
              users.forEach(u => { userMap[u.id] = u.displayName || u.username; });

              const allRecruiterKeys = Object.keys(all).filter(k => k.startsWith('recruiters_'));
              const merged = [];
              const seen   = new Set();
              allRecruiterKeys.forEach(k => {
                const ownerUserId = k.replace('recruiters_', '');
                (all[k] || []).forEach(r => {
                  if (!seen.has(r.id)) {
                    seen.add(r.id);
                    merged.push({
                      ...r,
                      _ownerKey:    k,
                      _ownerUserId: ownerUserId,
                      _ownerName:   userMap[ownerUserId] || ownerUserId,
                    });
                  }
                });
              });
              recruiters = merged;
            } else {
              recruiters = all[recruiterKey(userId)] || [];
            }

            const result = { hasOpenAI, hasFirebase, userOpenAIKey, userEnhancvKey, dbConnected: isConnected(), roles, recruiters, companies, companyScenario, companyScenarios };
            setCached(cacheKey, result);
            return res.json(result);
          }
        } catch (_) {}
      }

      // No auth token — still return basic env info
      const all = await S.getAll().catch(() => ({}));
      if (all.firebase_service_account) hasFirebase = true;
      if (all.openai_api_key)           hasOpenAI   = true;
      if (all.custom_roles)             roles       = all.custom_roles;
    }

    res.json({ hasOpenAI, hasFirebase, userOpenAIKey, userEnhancvKey, dbConnected: isConnected(), roles, recruiters, companies, companyScenario, companyScenarios });
  } catch (err) {
    res.json({ hasOpenAI: !!process.env.OPENAI_API_KEY, hasFirebase: !!process.env.FIREBASE_SERVICE_ACCOUNT, dbConnected: false, roles: null, recruiters: [], companies: [], companyScenario: '', companyScenarios: {}, userOpenAIKey: '', userEnhancvKey: '' });
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
    invalidateCache(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/enhancv-key ─────────────────────────────────────────────
router.put('/enhancv-key', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) return res.status(400).json({ error: 'API key is required' });
    await getSettings().setForUser(req.user.id, 'enhancv_key', apiKey.trim());
    invalidateCache(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/settings/enhancv-key ─────────────────────────────────────────
router.delete('/enhancv-key', requireAuth, async (req, res) => {
  try {
    await getSettings().setForUser(req.user.id, 'enhancv_key', null);
    invalidateCache(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/extract-linkedin ──────────────────────────────────────
// Extract candidate profile data from a LinkedIn URL using Piloterr API
router.post('/extract-linkedin', requireAuth, async (req, res) => {
  try {
    const { linkedinUrl } = req.body;
    if (!linkedinUrl) return res.status(400).json({ error: 'LinkedIn URL is required' });

    // Resolve API key: user key → admin key → env
    const S = getSettings();
    let apiKey = await S.getForUser(req.user.id, 'enhancv_key').catch(() => null);
    if (!apiKey && !req.user.isAdmin) {
      try {
        const User = require('../models/User');
        const users = await User.findAll();
        const admins = users.filter(u => u.isAdmin);
        for (const admin of admins) {
          apiKey = await S.getForUser(admin.id, 'enhancv_key').catch(() => null);
          if (apiKey) break;
        }
      } catch (_) {}
    }
    if (!apiKey) apiKey = process.env.PILOTERR_API_KEY || null;
    if (!apiKey) return res.status(400).json({ error: 'Piloterr API key not configured. Please add your key in Settings → Account.' });

    console.log('[extract-linkedin] using key prefix:', apiKey.slice(0, 6), '...', 'url:', linkedinUrl);

    // Call Piloterr LinkedIn profile API
    const response = await axios.get(
      'https://piloterr.com/api/v2/linkedin/profile',
      {
        params: { query: linkedinUrl },
        headers: { 'x-api-key': apiKey },
        timeout: 30000,
      }
    );

    const profile = response.data;

    // Map Piloterr response to our candidate fields
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ')
      || profile.full_name || profile.name || '';

    const result = {
      fullName,
      email:        profile.email || '',
      phone:        profile.phone || '',
      location:     profile.location || profile.city || '',
      currentTitle: profile.headline || profile.title || '',
      linkedinUrl,
      photoUrl:     profile.profile_picture || profile.photo_url || '',
      resumeText:   buildResumeText(profile),
    };

    res.json(result);
  } catch (err) {
    const status = err.response?.status;
    const piloterrBody = err.response?.data;
    const msg = (typeof piloterrBody === 'string' ? piloterrBody : piloterrBody?.message || piloterrBody?.error || piloterrBody?.detail) || err.message;
    console.error('[extract-linkedin] Piloterr error', status, JSON.stringify(piloterrBody));
    if (status === 401 || status === 403) return res.status(400).json({ error: `Piloterr auth failed (${status}): ${msg || 'Invalid API key'}` });
    if (status === 404) return res.status(400).json({ error: 'LinkedIn profile not found or not accessible.' });
    if (status === 429) return res.status(429).json({ error: 'Piloterr rate limit reached. Try again later.' });
    res.status(500).json({ error: `LinkedIn extraction failed: ${msg}` });
  }
});

function buildResumeText(profile) {
  // Piloterr uses snake_case; also handle camelCase for forward compat
  const lines = [];
  const summary = profile.summary || profile.about || '';
  if (summary) lines.push(`Summary:\n${summary}`);

  const experiences = profile.experiences || profile.experience || [];
  if (Array.isArray(experiences) && experiences.length) {
    lines.push('Experience:');
    experiences.forEach(e => {
      const title   = e.title || '';
      const company = e.company || e.company_name || '';
      const start   = e.start_date || e.startDate || '';
      const end     = e.end_date   || e.endDate   || 'present';
      lines.push(`  ${title} at ${company} (${start}–${end})`);
      if (e.description) lines.push(`  ${e.description}`);
    });
  }

  const educations = profile.educations || profile.education || [];
  if (Array.isArray(educations) && educations.length) {
    lines.push('Education:');
    educations.forEach(e => {
      const degree = e.degree_name || e.degree || '';
      const school = e.school || e.school_name || '';
      const start  = e.start_date || e.startDate || '';
      const end    = e.end_date   || e.endDate   || '';
      lines.push(`  ${degree} at ${school} (${start}–${end})`);
    });
  }

  const skills = profile.skills || [];
  if (Array.isArray(skills) && skills.length) {
    lines.push(`Skills: ${skills.map(s => s.name || s).join(', ')}`);
  }

  const languages = profile.languages || [];
  if (Array.isArray(languages) && languages.length) {
    lines.push(`Languages: ${languages.map(l => l.name || l).join(', ')}`);
  }

  return lines.join('\n');
}

// ── PUT /api/settings/company-scenario ───────────────────────────────────────
// Legacy single-scenario endpoint (kept for backward compat)
router.put('/company-scenario', requireAuth, async (req, res) => {
  try {
    await getSettings().setForUser(req.user.id, 'company_scenario', req.body.scenario || '');
    invalidateCache(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/company-scenarios ──────────────────────────────────────
// Saves the full map: { '': 'default scenario', 'co_123': 'Acme scenario', ... }
// Firestore rejects empty-string keys, so '' is stored as '_default'
router.put('/company-scenarios', requireAuth, async (req, res) => {
  try {
    const raw = req.body.scenarios || {};
    const safe = {};
    for (const [k, v] of Object.entries(raw)) {
      safe[k === '' ? '_default' : k] = v;
    }
    await getSettings().setForUser(req.user.id, 'company_scenarios', safe);
    invalidateCache(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/recruiters ─────────────────────────────────────────────
router.put('/recruiters', requireAuth, async (req, res) => {
  try {
    const targetUserId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    await getSettings().set(recruiterKey(targetUserId), req.body.recruiters || []);
    invalidateCache(targetUserId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/companies ───────────────────────────────────────────────
router.put('/companies', requireAuth, async (req, res) => {
  try {
    await getSettings().setForUser(req.user.id, 'companies', req.body.companies || []);
    invalidateCache(req.user.id);
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
    const { category = 'company_docs', companyId = '', companyName = '' } = req.body;
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    const item = await getKB().create({
      name: req.file.originalname, type: 'file', content: text,
      fileName: req.file.originalname, category, companyId, companyName,
      ownerId: req.user.id, ownerName: req.user.displayName || req.user.username,
    });
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/url ─────────────────────────────────────────
router.post('/knowledge/url', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { url, category = 'company_docs', companyId = '', companyName = '' } = req.body;
    let text = '', siteName = new URL(url).hostname;

    const BROWSER_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
    };

    let fetchError = null;
    let response   = null;

    // First attempt — full browser headers
    try {
      response = await axios.get(url, { timeout: 20000, headers: BROWSER_HEADERS, maxRedirects: 5 });
    } catch (e) {
      fetchError = e;
    }

    // Second attempt — minimal headers (some servers reject Accept-Encoding)
    if (!response && fetchError) {
      try {
        response = await axios.get(url, {
          timeout: 20000,
          headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Accept': 'text/html,*/*' },
          maxRedirects: 5,
          decompress: false,
        });
        fetchError = null;
      } catch (e2) {
        // Surface the original error if both attempts fail
      }
    }

    if (!response) {
      const status = fetchError?.response?.status;
      const friendlyErrors = {
        401: 'The page requires authentication — try copying the text manually.',
        403: 'Access denied by the website — it blocks automated requests.',
        404: 'Page not found (404). Check the URL.',
        429: 'The website is rate-limiting requests — try again in a few minutes.',
        451: 'The website is unavailable for legal/geo reasons (HTTP 451). Try a different URL or paste the content as custom instructions instead.',
        503: 'The website is temporarily unavailable — try again later.',
      };
      const msg = friendlyErrors[status] || fetchError?.message || 'Could not fetch the URL';
      return res.status(422).json({ error: msg });
    }

    const $ = cheerio.load(response.data);
    $('script,style,nav,footer,header,aside,iframe,noscript').remove();
    siteName = $('title').text().trim() || siteName;
    text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000);

    if (!text) {
      return res.status(422).json({ error: 'No readable text found on this page. The site may require JavaScript to render. Try pasting the content as custom instructions instead.' });
    }

    const item = await getKB().create({
      name: siteName, type: 'url', content: text, url, category, companyId, companyName,
      ownerId: req.user.id, ownerName: req.user.displayName || req.user.username,
    });
    res.json({ ...item, charCount: text.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/instructions ─────────────────────────────────
router.post('/knowledge/instructions', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { content, name = 'Custom Instructions', companyId = '', companyName = '' } = req.body;
    const item = await getKB().create({
      name, type: 'custom_instructions', content,
      category: 'instructions', companyId, companyName,
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
