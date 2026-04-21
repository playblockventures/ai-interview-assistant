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
  settingsCache.delete(`admin_${userId}`);
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
            // Admin with explicit ?userId skips the shared 'admin' cache — returns per-user data
            const cacheKey = payload.isAdmin
              ? (req.query.userId ? `admin_${req.query.userId}` : 'admin')
              : userId;
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

            if (payload.isAdmin && !req.query.userId) {
              // Admin without a specific userId → merged view of ALL users' data
              const User = require('../models/User');
              const allUsers = await User.findAll().catch(() => []);
              const userMap = {};
              allUsers.forEach(u => { userMap[u.id] = u.displayName || u.username; });

              // Merge companies — no deduplication: each key is a separate user's list
              const allCompanyKeys = Object.keys(all).filter(k => k.startsWith('companies_'));
              const mergedCompanies = [];
              allCompanyKeys.forEach(k => {
                const ownerUserId = k.replace('companies_', '');
                (all[k] || []).forEach(c => {
                  mergedCompanies.push({ ...c, _ownerUserId: ownerUserId, _ownerName: userMap[ownerUserId] || ownerUserId });
                });
              });
              if (mergedCompanies.length > 0) companies = mergedCompanies;

              // Merge recruiters — no deduplication: each key is a separate user's list
              const allRecruiterKeys = Object.keys(all).filter(k => k.startsWith('recruiters_'));
              const merged = [];
              allRecruiterKeys.forEach(k => {
                const ownerUserId = k.replace('recruiters_', '');
                (all[k] || []).forEach(r => {
                  merged.push({ ...r, _ownerKey: k, _ownerUserId: ownerUserId, _ownerName: userMap[ownerUserId] || ownerUserId });
                });
              });
              recruiters = merged;
            } else {
              // Specific userId requested (or non-admin) → return just that user's data
              recruiters = all[recruiterKey(userId)] || [];
              companies  = all[companiesKey(userId)] || [];
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

// ── GET /api/settings/pins ───────────────────────────────────────────────────
router.get('/pins', requireAuth, async (req, res) => {
  try {
    const S = getSettings();
    const pins = await S.getForUser(req.user.id, 'pinned_candidates').catch(() => null) || [];
    res.json({ pins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/pins/:candidateId ─────────────────────────────────────
router.post('/pins/:candidateId', requireAuth, async (req, res) => {
  try {
    const S = getSettings();
    const pins = await S.getForUser(req.user.id, 'pinned_candidates').catch(() => null) || [];
    if (!pins.includes(req.params.candidateId)) {
      pins.push(req.params.candidateId);
      await S.setForUser(req.user.id, 'pinned_candidates', pins);
    }
    res.json({ pins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/settings/pins/:candidateId ───────────────────────────────────
router.delete('/pins/:candidateId', requireAuth, async (req, res) => {
  try {
    const S = getSettings();
    const pins = await S.getForUser(req.user.id, 'pinned_candidates').catch(() => null) || [];
    const updated = pins.filter(id => id !== req.params.candidateId);
    await S.setForUser(req.user.id, 'pinned_candidates', updated);
    res.json({ pins: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/pins/:candidateId/share ───────────────────────────────
// Share a pinned candidate with another user (or admin shares to a user)
router.post('/pins/:candidateId/share', requireAuth, async (req, res) => {
  try {
    const { targetUserId, candidateName } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    const Notification = require('../models/Notification');
    const senderName = req.user.displayName || req.user.username;
    await Notification.create({
      userId: targetUserId,
      type: 'pin_share',
      title: `${senderName} shared a candidate with you`,
      message: `${senderName} pinned ${candidateName || 'a candidate'} and shared it with you. Click to view.`,
      candidateId: req.params.candidateId,
      candidateName: candidateName || '',
      createdBy: req.user.id,
      createdByName: senderName,
    });
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
      'https://api.piloterr.com/v2/linkedin/profile/info',
      {
        params: { query: linkedinUrl },
        headers: { 'x-api-key': apiKey },
        timeout: 30000,
      }
    );

    const profile = response.data;

    // Log full raw response so we can see exactly what Piloterr returns for this plan
    console.log('[extract-linkedin] RAW RESPONSE:', JSON.stringify(profile, null, 2));

    // Map Piloterr response to our candidate fields
    const fullName = profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || '';

    // Location: Piloterr returns address as a string or null
    const addr = profile.address || profile.location_info || profile.location || {};
    const location = (typeof addr === 'string' && addr)
      ? addr
      : [addr.city, addr.country || addr.country_code].filter(Boolean).join(', ')
        || profile.city || profile.country || '';

    const photoUrl = profile.photo_url || profile.profile_picture || profile.picture || profile.avatar || '';

    // Headline: Piloterr returns the LinkedIn headline in the "headline" field
    const currentTitle =
      profile.headline       ||   // Piloterr primary headline field
      profile.sub_title      ||   // legacy/alternative name
      profile.occupation     ||   // sometimes used
      profile.job_title      ||   // top-level job title (some endpoints)
      profile.title          ||   // generic fallback
      (Array.isArray(profile.experiences) && profile.experiences.length
        ? (profile.experiences[0]?.job_title || profile.experiences[0]?.title || profile.experiences[0]?.role)
        : '') ||
      '';

    const result = {
      fullName,
      email:        profile.email || '',  // usually empty; included if API returns it
      phone:        profile.phone || profile.phone_number || '',
      location,
      currentTitle,
      linkedinUrl,
      photoUrl,
      resumeText:   buildResumeText(profile),
    };

    res.json({ ...result, _raw: profile });
  } catch (err) {
    const status = err.response?.status;
    const piloterrBody = err.response?.data;
    const msg = (typeof piloterrBody === 'string' ? piloterrBody : piloterrBody?.message || piloterrBody?.error || piloterrBody?.detail) || err.message;
    console.error('[extract-linkedin] Piloterr error', status, JSON.stringify(piloterrBody));
    if (status === 401) return res.status(400).json({ error: 'Invalid Piloterr API key. Check your key in Settings → Account.' });
    if (status === 403) return res.status(400).json({ error: 'Piloterr plan does not include LinkedIn profile access. Please upgrade your Piloterr plan or use a key with LinkedIn API access.' });
    if (status === 404) return res.status(400).json({ error: 'LinkedIn profile not found or not accessible.' });
    if (status === 429) return res.status(429).json({ error: 'Piloterr rate limit reached. Try again later.' });
    res.status(500).json({ error: `LinkedIn extraction failed: ${msg}` });
  }
});

function buildResumeText(profile) {
  const lines = [];

  // Headline (LinkedIn tagline)
  const headline = profile.headline || profile.sub_title || profile.occupation || '';
  if (headline) lines.push(`Headline: ${headline}`);

  // Bio / summary
  const summary = profile.summary || profile.about || profile.description || '';
  if (summary) lines.push(`\nSummary:\n${summary}`);

  // Experience — Piloterr uses "experiences" with "job_title" field
  const experiences = profile.experiences || profile.experience || [];
  if (Array.isArray(experiences) && experiences.length) {
    lines.push('\nExperience:');
    experiences.forEach(e => {
      const title   = e.job_title || e.title || e.role || '';
      const company = e.company || e.company_name || '';
      const start   = e.start_date || '';
      const end     = e.end_date || 'present';
      const dateStr = start ? ` (${start} – ${end})` : '';
      const header  = [title, company].filter(Boolean).join(' at ');
      if (header) lines.push(`  ${header}${dateStr}`);
      if (e.description) lines.push(`    ${e.description}`);
    });
  }

  // Education — Piloterr uses "educations" with "school", "field_of_study", start/end_year
  const educations = profile.educations || profile.education || [];
  if (Array.isArray(educations) && educations.length) {
    lines.push('\nEducation:');
    educations.forEach(e => {
      const degree = e.degree_name || e.degree || e.field_of_study || '';
      const school = e.school || e.school_name || '';
      const start  = e.start_year || (e.start_date ? e.start_date.slice(0, 4) : '');
      const end    = e.end_year   || (e.end_date   ? e.end_date.slice(0, 4)   : '');
      const dateStr = (start || end) ? ` (${[start, end].filter(Boolean).join('–')})` : '';
      const header  = [degree, school].filter(Boolean).join(' at ');
      if (header) lines.push(`  ${header}${dateStr}`);
    });
  }

  // Certifications
  const certs = profile.certifications || [];
  if (Array.isArray(certs) && certs.length) {
    lines.push('\nCertifications:');
    certs.forEach(c => {
      const name = c.name || c.title || (typeof c === 'string' ? c : '');
      const org  = c.authority || c.organization || c.issuer || '';
      if (name) lines.push(`  ${name}${org ? ' — ' + org : ''}`);
    });
  }

  // Skills — Piloterr returns plain strings
  const skills = profile.skills || [];
  if (Array.isArray(skills) && skills.length) {
    const skillNames = skills.map(s => (typeof s === 'string' ? s : s.name || '')).filter(Boolean);
    if (skillNames.length) lines.push(`\nSkills: ${skillNames.join(', ')}`);
  }

  // Languages
  const languages = profile.languages || [];
  if (Array.isArray(languages) && languages.length) {
    const langNames = languages.map(l => (typeof l === 'string' ? l : l.name || '')).filter(Boolean);
    if (langNames.length) lines.push(`Languages: ${langNames.join(', ')}`);
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
    const targetUserId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    const raw = req.body.scenarios || {};
    const safe = {};
    for (const [k, v] of Object.entries(raw)) {
      safe[k === '' ? '_default' : k] = v;
    }
    await getSettings().setForUser(targetUserId, 'company_scenarios', safe);
    invalidateCache(targetUserId);
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
    const targetUserId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    await getSettings().setForUser(targetUserId, 'companies', req.body.companies || []);
    invalidateCache(targetUserId);
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

// ── POST /api/settings/knowledge/reassign-owner ──────────────────────────────
// Transfers ownerId of all KB items for a company from one user to another (admin only)
router.post('/knowledge/reassign-owner', requireAuth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { fromUserId, toUserId, companyId } = req.body;
    if (!fromUserId || !toUserId) return res.status(400).json({ error: 'fromUserId and toUserId are required' });
    const count = await getKB().reassignOwner(fromUserId, toUserId, companyId ?? '');
    invalidateCache(fromUserId);
    invalidateCache(toUserId);
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/knowledge/reassign ────────────────────────────────────
router.post('/knowledge/reassign', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Firebase not connected.' });
  try {
    const { fromCompanyId, toCompanyId, toCompanyName } = req.body;
    if (toCompanyId === undefined) return res.status(400).json({ error: 'toCompanyId is required' });
    const targetUserId = (req.user.isAdmin && req.query.userId) ? req.query.userId : req.user.id;
    const count = await getKB().reassignCompany(targetUserId, fromCompanyId ?? '', toCompanyId, toCompanyName || '');
    invalidateCache(targetUserId);
    res.json({ success: true, count });
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
