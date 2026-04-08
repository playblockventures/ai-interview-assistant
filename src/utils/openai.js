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
// Includes ALL their uploaded docs, URLs and custom instructions
const getKnowledgeContext = async (userId) => {
  if (!isConnected() || !userId) return '';
  try {
    const KnowledgeBase = require('../models/KnowledgeBase');
    const docs = await KnowledgeBase.findByUser(userId);
    if (!docs.length) return '';

    // Budget: 12000 chars total across all docs (fits comfortably in GPT-4o context)
    const TOTAL_BUDGET = 12000;
    const perDoc       = Math.floor(TOTAL_BUDGET / Math.min(docs.length, 15));

    const sections = docs.slice(0, 15).map(d => {
      const content = (d.content || '').trim();
      const truncated = content.length > perDoc
        ? content.substring(0, perDoc) + '... [truncated]'
        : content;
      return `### ${d.name} (${d.category || d.type})\n${truncated}`;
    });

    return '\n\n--- COMPANY KNOWLEDGE BASE ---\n' +
      'The following documents contain company information, project requirements, and instructions. ' +
      'You MUST follow any requirements, processes, or instructions described in these documents. ' +
      'Use this knowledge to guide and personalise all your responses:\n\n' +
      sections.join('\n\n');
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

// Get company scenario for a user
const getCompanyScenario = async (userId) => {
  if (!isConnected() || !userId) return '';
  try {
    const Settings = require('../models/Settings');
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
