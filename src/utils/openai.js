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
    // Filter by company if specified; otherwise use all docs
    const docs = companyId
      ? allDocs.filter(d => d.companyId === companyId)
      : allDocs;
    if (!docs.length) return '';

    // Budget: 12000 chars total across all docs (fits comfortably in GPT-4o context)
    const TOTAL_BUDGET = 12000;
    const perDoc       = Math.floor(TOTAL_BUDGET / Math.min(docs.length, 15));

    const sections = docs.slice(0, 15).map(d => {
      const content = (d.content || '').trim();
      const truncated = content.length > perDoc
        ? content.substring(0, perDoc) + '... [truncated]'
        : content;
      const label = d.companyName ? `${d.name} — ${d.companyName}` : d.name;
      return `### ${label} (${d.category || d.type})\n${truncated}`;
    });

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
      const fallback = scenariosMap[''] || '';
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
