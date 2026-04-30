const OpenAI = require('openai');
const { isConnected } = require('./firebase');

// Cache clients per API key
const clientCache = new Map();

// Get OpenAI client — user key → global env → global DB
const getOpenAIClient = async (userId) => {
  let apiKey = null;

  if (userId && isConnected()) {
    try {
      const Settings = require('../models/Settings');
      apiKey = await Settings.getForUser(userId, 'openai_key');
    } catch (_) {}
  }

  if (!apiKey) apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey && isConnected()) {
    try {
      const Settings = require('../models/Settings');
      apiKey = await Settings.get('openai_api_key');
    } catch (_) {}
  }

  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please add your API key in Settings → Account.');
  }

  if (!clientCache.has(apiKey)) {
    clientCache.set(apiKey, new OpenAI({ apiKey }));
  }
  return clientCache.get(apiKey);
};

// Build full knowledge base context for a user
// If companyId is provided, only include docs for that company
const getKnowledgeContext = async (userId, companyId = null) => {
  if (!isConnected() || !userId) return '';
  try {
    const KnowledgeBase = require('../models/KnowledgeBase');
    const allDocs = await KnowledgeBase.findByUser(userId);
    // Filter by company if specified: include company-specific docs AND general (no company) docs.
    // General docs (no companyId) are always included as shared context.
    const docs = companyId
      ? allDocs.filter(d => d.companyId === companyId || !d.companyId)
      : allDocs;
    if (!docs.length) return '';

    // Each doc gets up to 80k chars; total context capped at 120k
    // (GPT-4o has a 128k token window — ~512k chars — so this is well within limits)
    const MAX_PER_DOC   = 80000;
    const TOTAL_BUDGET  = 120000;
    let remaining = TOTAL_BUDGET;

    const sections = [];
    for (const d of docs.slice(0, 20)) {
      if (remaining <= 0) break;
      const content  = (d.content || '').trim();
      const cap      = Math.min(content.length, MAX_PER_DOC, remaining);
      const truncated = content.length > cap ? content.substring(0, cap) + '... [truncated]' : content;
      const label    = d.companyName ? `${d.name} — ${d.companyName}` : d.name;
      sections.push(`### ${label} (${d.category || d.type})\n${truncated}`);
      remaining -= truncated.length;
    }

    return '\n\n=== COMPANY KNOWLEDGE BASE (READ THIS FIRST — MANDATORY) ===\n' +
      'The following documents define the company context, project requirements, technologies, and evaluation criteria. ' +
      'You MUST read and apply this knowledge. Base your interview questions, assessments, and responses ' +
      'directly on the specifics found here. Do NOT ignore this section.\n\n' +
      sections.join('\n\n') +
      '\n=== END OF KNOWLEDGE BASE ===';
  } catch (e) {
    console.error('[OpenAI] Knowledge context error:', e.message);
    return '';
  }
};

// Get custom instructions for a user
const getCustomInstructions = async (userId) => {
  if (!isConnected() || !userId) return '';
  try {
    const Settings = require('../models/Settings');
    const value = await Settings.getForUser(userId, 'custom_instructions');
    return value ? `\n\n--- CUSTOM INSTRUCTIONS ---\n${value}` : '';
  } catch (_) { return ''; }
};

// Get company scenario for a user, optionally scoped to a companyId
// Looks up per-company first, then falls back to the default (no-company) scenario
const getCompanyScenario = async (userId, companyId = null) => {
  if (!isConnected() || !userId) return '';
  try {
    const Settings = require('../models/Settings');
    // Try new per-company scenarios map first
    const scenariosMap = await Settings.getForUser(userId, 'company_scenarios').catch(() => null);
    if (scenariosMap && typeof scenariosMap === 'object') {
      const specific = companyId && scenariosMap[companyId] ? scenariosMap[companyId] : '';
      // Default stored as '_default' in Firestore (empty string keys are rejected)
      const fallback = scenariosMap['_default'] || scenariosMap[''] || '';
      const value = specific || fallback;
      return value ? `\n\n--- COMPANY INTERVIEW SCENARIO (follow this structure) ---\n${value}` : '';
    }
    // Fall back to legacy single-value key
    const value = await Settings.getForUser(userId, 'company_scenario');
    return value ? `\n\n--- COMPANY INTERVIEW SCENARIO (follow this structure) ---\n${value}` : '';
  } catch (_) { return ''; }
};

// Build the full system context string for AI calls
// Combines KB + custom instructions + company scenario
const buildSystemContext = async (userId) => {
  const [kb, instructions, scenario] = await Promise.all([
    getKnowledgeContext(userId),
    getCustomInstructions(userId),
    getCompanyScenario(userId),
  ]);
  return [kb, instructions, scenario].filter(Boolean).join('');
};

module.exports = {
  getOpenAIClient,
  getKnowledgeContext,
  getCustomInstructions,
  getCompanyScenario,
  buildSystemContext,
};
