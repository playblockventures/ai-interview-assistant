const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Candidate = require('../models/Candidate');
const { getOpenAIClient, getKnowledgeContext, getCustomInstructions, getCompanyScenario, buildSystemContext } = require('../utils/openai');
const { requireAuth } = require('../utils/auth');

router.use(requireAuth);

// Helper: get the effective userId for AI context
// If admin is generating for a candidate, use the candidate's owner's context
// so the right KB and API key are used
const getEffectiveUserId = async (req, candidateId) => {
  if (!req.user.isAdmin || !candidateId) return req.user.id;
  try {
    const c = await Candidate.findById(candidateId);
    return (c && c.ownerId) ? c.ownerId : req.user.id;
  } catch (_) { return req.user.id; }
};

const DEFAULT_ROLES = {
  cto:              'Chief Technology Officer (CTO)',
  lead_blockchain:  'Lead Blockchain Engineer',
  smart_contract:   'Smart Contract Engineer',
  backend:          'Backend Engineer',
  frontend_web3:    'Frontend Engineer (Web3)',
  designer:         'Designer',
  strategic_partner:'Strategic Partner',
  advisor:          'Advisor',
};

const TONES = {
  professional: 'professional and formal',
  friendly:     'warm and friendly',
  casual:       'casual and conversational',
  assertive:    'direct and assertive',
  feminine:     'empathetic, warm, and nurturing with a feminine tone',
};

async function resolveRoleLabel(role) {
  try {
    if (!role) return role;
    const { isConnected } = require('../utils/firebase');
    if (!isConnected()) return DEFAULT_ROLES[role] || role;
    const Settings = require('../models/Settings');
    const customRoles = await Settings.get('custom_roles');
    if (customRoles && Array.isArray(customRoles)) {
      const found = customRoles.find(r => r.value === role || r.label === role);
      if (found) return found.label;
    }
  } catch (_) {}
  return DEFAULT_ROLES[role] || role;
}

async function getRecruiterContext(recruiterId) {
  if (!recruiterId) return '';
  try {
    const { isConnected } = require('../utils/firebase');
    if (!isConnected()) return '';
    const Settings = require('../models/Settings');
    const recruiters = await Settings.get('recruiters');
    if (!recruiters || !Array.isArray(recruiters)) return '';
    const recruiter = recruiters.find(r => r.id === recruiterId);
    if (!recruiter) return '';
    let ctx = `\n\n--- RECRUITER PROFILE (${recruiter.name}) ---\n${recruiter.profile || ''}`;
    if (recruiter.photoUrl) ctx += '\n[Recruiter has a profile photo on file]';
    return ctx;
  } catch (_) { return ''; }
}

// POST /generate/scenario
router.post('/scenario', async (req, res) => {
  try {
    const { candidateId, role, goal, tone = 'professional', customInstructions, recruiterId } = req.body;
    const effectiveUserId = await getEffectiveUserId(req, candidateId);
    const openai = await getOpenAIClient(effectiveUserId);
    const systemContext = await buildSystemContext(effectiveUserId);
    const recruiterContext = await getRecruiterContext(recruiterId);

    let candidateContext = '';
    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (candidate && Candidate.canAccess(candidate, req.user)) {
        candidateContext = `\nCANDIDATE PROFILE:\nName: ${candidate.fullName}\nEmail: ${candidate.email}\nPhone: ${candidate.phone || 'N/A'}\nLocation: ${candidate.location || 'N/A'}\nCurrent Title: ${candidate.currentTitle || 'N/A'}\nLinkedIn: ${candidate.linkedinUrl || 'N/A'}\nResume:\n${candidate.resumeText?.substring(0, 2000) || 'Not provided'}`;
      }
    }

    const roleLabel = await resolveRoleLabel(role);
    const toneLabel = TONES[tone] || tone;

    const prompt = `You are an expert technical recruiter and interview coach. Generate a comprehensive, structured interview scenario for a ${roleLabel} position.\n\n${candidateContext}\n${systemContext}\n${recruiterContext}\n${customInstructions ? `\nADDITIONAL INSTRUCTIONS:\n${customInstructions}` : ''}\n\nINTERVIEW GOAL: ${goal || 'Assess technical competency and cultural fit'}\nTONE: ${toneLabel}\n\nGenerate a complete interview scenario with:\n1. **Interview Overview** - Brief context and objectives\n2. **Opening Questions** (3-4) - Warm-up and background\n3. **Technical Assessment** (5-7 role-specific questions with expected answers)\n4. **Behavioral Questions** (3-4) - Situation-based\n5. **Culture & Motivation** (2-3 questions)\n6. **Closing** - Questions to offer the candidate, next steps\n7. **Evaluation Rubric** - Key criteria and scoring guide\n\nMake it conversational, insightful, and tailored to the candidate profile if provided. Use the ${toneLabel} tone throughout.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500,
      temperature: 0.7,
    });

    const scenario = completion.choices[0].message.content;
    if (candidate) await Candidate.pushScenario(candidateId, { content: scenario, role: roleLabel });
    res.json({ scenario, role: roleLabel, candidateId });
  } catch (err) {
    console.error('[Generate scenario]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /generate/outreach
router.post('/outreach', async (req, res) => {
  try {
    const { candidateId, role, messageType = 'outreach', tone = 'professional', goal, customInstructions, recruiterId } = req.body;
    const effectiveUserId = await getEffectiveUserId(req, candidateId);
    const openai = await getOpenAIClient(effectiveUserId);
    const systemContext = await buildSystemContext(effectiveUserId);
    const recruiterContext = await getRecruiterContext(recruiterId);

    let candidateContext = '';
    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (candidate && Candidate.canAccess(candidate, req.user)) {
        candidateContext = `\nCANDIDATE:\nName: ${candidate.fullName}\nEmail: ${candidate.email}\nLocation: ${candidate.location || 'N/A'}\nCurrent Title: ${candidate.currentTitle || 'N/A'}\nResume summary: ${candidate.resumeText?.substring(0, 1000) || 'Not provided'}`;
      }
    }

    const roleLabel = await resolveRoleLabel(role);
    const toneLabel = TONES[tone] || tone;
    const messageTypeDesc = {
      outreach:  'initial outreach / cold contact',
      screening: 'screening interview invitation',
      technical: 'technical interview invitation',
      followup:  'follow-up after previous conversation',
    }[messageType] || messageType;

    const prompt = `You are an expert recruiter writing a ${messageTypeDesc} message for a ${roleLabel} position.\n\n${candidateContext}\n${systemContext}\n${recruiterContext}\n${customInstructions ? `\nADDITIONAL INSTRUCTIONS:\n${customInstructions}` : ''}\n\nGoal: ${goal || 'Connect with the candidate and initiate a conversation about the opportunity'}\nTone: ${toneLabel}\n\nWrite a compelling, personalized ${messageTypeDesc} message that:\n- Feels genuine and human, not templated\n- References specific details from the candidate's background if available\n- Clearly communicates the opportunity and value proposition\n- Has a clear call-to-action\n- Is the right length for ${messageType} (concise for outreach, more detailed for technical)\n\nFormat:\nSubject: [email subject line]\n\n[Message body]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.8,
    });

    const message = completion.choices[0].message.content;
    if (candidate) await Candidate.pushOutreachMessage(candidateId, { content: message, type: messageType });
    res.json({ message, messageType, role: roleLabel, candidateId });
  } catch (err) {
    console.error('[Generate outreach]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /generate/conversation
// Supports text replies and image uploads (base64 encoded)
router.post('/conversation', async (req, res) => {
  try {
    const {
      candidateId, candidateReply, role, tone = 'professional',
      history = [], recruiterId, customInstructions, imageBase64, imageMimeType,
    } = req.body;

    const effectiveUserId = await getEffectiveUserId(req, candidateId);
    const openai = await getOpenAIClient(effectiveUserId);
    const systemContext = await buildSystemContext(effectiveUserId);
    const recruiterContext   = await getRecruiterContext(recruiterId);

    let candidateContext = '';
    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (candidate && Candidate.canAccess(candidate, req.user)) {
        candidateContext = `\nCANDIDATE PROFILE:\nName: ${candidate.fullName}\nEmail: ${candidate.email}\nPhone: ${candidate.phone || 'N/A'}\nLocation: ${candidate.location || 'N/A'}\nCurrent Title: ${candidate.currentTitle || 'N/A'}\nResume summary: ${candidate.resumeText?.substring(0, 1500) || 'Not provided'}`;
      }
    }

    const roleLabel = await resolveRoleLabel(role);
    const toneLabel = TONES[tone] || tone;

    const systemPrompt = `You are an expert recruiter having a conversation with a job candidate for a ${roleLabel} position.
${candidateContext}
${systemContext}
${recruiterContext}
${customInstructions ? `\nCONVERSATION INSTRUCTIONS:\n${customInstructions}` : ''}

Maintain a ${toneLabel} tone. Generate the next ideal recruiter response based on what the candidate said.
Be natural, engaging, and move the conversation forward productively.
If the candidate sent an image, describe what you see and respond appropriately.
Keep responses concise but meaningful.`;

    // Build message history for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.imageBase64
          ? [
              { type: 'image_url', image_url: { url: `data:${h.imageMimeType || 'image/jpeg'};base64,${h.imageBase64}` } },
              ...(h.content ? [{ type: 'text', text: h.content }] : []),
            ]
          : h.content,
      })),
    ];

    // Current user message — may include an image
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}` } },
          ...(candidateReply ? [{ type: 'text', text: candidateReply }] : [{ type: 'text', text: '[Candidate sent an image]' }]),
        ],
      });
    } else {
      messages.push({ role: 'user', content: candidateReply });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 600,
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;

    // Persist to Firestore
    if (candidate) {
      const userEntry = {
        role: 'user',
        content: candidateReply || '',
        timestamp: new Date().toISOString(),
      };
      if (imageBase64) {
        userEntry.imageBase64 = imageBase64;
        userEntry.imageMimeType = imageMimeType || 'image/jpeg';
      }
      await Candidate.pushConversation(candidateId, [
        userEntry,
        { role: 'assistant', content: response, timestamp: new Date().toISOString() },
      ]);
    }

    res.json({ response, candidateId });
  } catch (err) {
    console.error('[Generate conversation]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /generate/export-pdf
router.post('/export-pdf', async (req, res) => {
  try {
    const { content, title = 'Interview Scenario', candidateName } = req.body;
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_')}.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).fillColor('#1a1a2e').text('AI Interview Tool', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).fillColor('#16213e').text(title, { align: 'center' });
    if (candidateName) doc.fontSize(12).fillColor('#444').text(`Candidate: ${candidateName}`, { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#ccc');
    doc.moveDown();
    doc.fontSize(11).fillColor('#222').text(content, { lineGap: 4 });
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#999').text(`Generated on ${new Date().toLocaleString()}`, { align: 'right' });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// POST /generate/recommend-role — suggest best role based on candidate resume
router.post('/recommend-role', async (req, res) => {
  try {
    const { resumeText, candidateId } = req.body;
    const openai = await getOpenAIClient(req.user.id);

    // Get available roles from settings or defaults
    let roleOptions = Object.values(DEFAULT_ROLES);
    try {
      const { isConnected } = require('../utils/firebase');
      if (isConnected()) {
        const Settings = require('../models/Settings');
        const customRoles = await Settings.get('custom_roles');
        if (customRoles && Array.isArray(customRoles) && customRoles.length > 0) {
          roleOptions = customRoles.map(r => r.label);
        }
      }
    } catch (_) {}

    let text = resumeText || '';
    if (!text && candidateId) {
      try {
        const candidate = await Candidate.findById(candidateId);
        if (candidate && Candidate.canAccess(candidate, req.user)) text = candidate.resumeText || '';
      } catch (_) {}
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert technical recruiter. Analyse a candidate profile and recommend the most suitable role. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Based on this candidate profile, recommend the best matching role from the available options.

AVAILABLE ROLES:
${roleOptions.map((r, i) => `${i + 1}. ${r}`).join('\n')}

CANDIDATE PROFILE:
${text.substring(0, 3000) || 'No resume provided'}

Return JSON:
{
  "recommendedRole": "exact role name from the list above",
  "confidence": "high|medium|low",
  "reasoning": "1-2 sentence explanation of why this role fits"
}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Find the matching role value
    let roleValue = '';
    try {
      const { isConnected } = require('../utils/firebase');
      const Settings = require('../models/Settings');
      const customRoles = isConnected() ? await Settings.get('custom_roles') : null;
      const allRoles = (customRoles && Array.isArray(customRoles) && customRoles.length > 0)
        ? customRoles
        : Object.entries(DEFAULT_ROLES).map(([value, label]) => ({ value, label }));
      const match = allRoles.find(r => r.label === result.recommendedRole ||
        r.label.toLowerCase() === result.recommendedRole?.toLowerCase());
      roleValue = match?.value || result.recommendedRole || '';
    } catch (_) { roleValue = result.recommendedRole || ''; }

    res.json({ ...result, roleValue });
  } catch (err) {
    console.error('[Recommend role]', err);
    res.status(500).json({ error: err.message });
  }
});
