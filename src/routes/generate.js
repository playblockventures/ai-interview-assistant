const express      = require('express');
const router       = express.Router();
const PDFDocument  = require('pdfkit');
const Candidate    = require('../models/Candidate');
const { getOpenAIClient, getKnowledgeContext, getCustomInstructions, getCompanyScenario } = require('../utils/openai');
const { requireAuth } = require('../utils/auth');

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

const getEffectiveUserId = async (req, candidateId) => {
  if (!req.user.isAdmin || !candidateId) return req.user.id;
  try {
    const c = await Candidate.findById(candidateId);
    return (c && c.ownerId) ? c.ownerId : req.user.id;
  } catch (_) { return req.user.id; }
};

const DEFAULT_ROLES = {
  cto:               'Chief Technology Officer (CTO)',
  lead_blockchain:   'Lead Blockchain Engineer',
  smart_contract:    'Smart Contract Engineer',
  backend:           'Backend Engineer',
  frontend_web3:     'Frontend Engineer (Web3)',
  designer:          'Designer',
  strategic_partner: 'Strategic Partner',
  advisor:           'Advisor',
};

const TONES = {
  professional: 'professional and formal',
  friendly:     'warm and friendly',
  casual:       'casual and conversational',
  assertive:    'direct and assertive',
  feminine:     'empathetic, warm, and nurturing',
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

// Recruiter context — reads from user-scoped recruiters first, then global
async function getRecruiterContext(recruiterId, userId) {
  if (!recruiterId) return '';
  try {
    const { isConnected } = require('../utils/firebase');
    if (!isConnected()) return '';
    const Settings = require('../models/Settings');

    // Try user-scoped recruiters first
    let recruiter = null;
    if (userId) {
      const userRecruiters = await Settings.get(`recruiters_${userId}`);
      if (Array.isArray(userRecruiters)) {
        recruiter = userRecruiters.find(r => r.id === recruiterId);
      }
    }
    // Fall back to global recruiters list
    if (!recruiter) {
      const allSettings = await Settings.getAll();
      const allRecruiterKeys = Object.keys(allSettings).filter(k => k.startsWith('recruiters_'));
      for (const key of allRecruiterKeys) {
        const list = allSettings[key];
        if (Array.isArray(list)) {
          recruiter = list.find(r => r.id === recruiterId);
          if (recruiter) break;
        }
      }
    }

    if (!recruiter) return '';
    return `\n\n--- RECRUITER PROFILE ---\nName: ${recruiter.name}\nTitle: ${recruiter.currentTitle || ''}\nLocation: ${recruiter.location || ''}\nEmail: ${recruiter.email || ''}\nBio/Style: ${recruiter.profile || ''}\nWrite messages and responses in the voice and style of this recruiter.`;
  } catch (_) { return ''; }
}

// Build candidate context string
function buildCandidateContext(candidate, resumeLength = 2000) {
  if (!candidate) return '';
  return `\n--- CANDIDATE PROFILE ---\nName: ${candidate.fullName || 'N/A'}\nEmail: ${candidate.email || 'N/A'}\nPhone: ${candidate.phone || 'N/A'}\nLocation: ${candidate.location || 'N/A'}\nCurrent Title: ${candidate.currentTitle || 'N/A'}\nLinkedIn: ${candidate.linkedinUrl || 'N/A'}\nResume:\n${candidate.resumeText?.substring(0, resumeLength) || 'Not provided'}`;
}

// ── POST /generate/scenario ───────────────────────────────────────────────────
router.post('/scenario', async (req, res) => {
  try {
    const { candidateId, role, goal, tone = 'professional', customInstructions, recruiterId, companyId: companyIdOverride } = req.body;

    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (!Candidate.canAccess(candidate, req.user)) candidate = null;
    }

    const effectiveUserId  = await getEffectiveUserId(req, candidateId);
    const companyId        = companyIdOverride ?? candidate?.companyId ?? null;
    const openai           = await getOpenAIClient(effectiveUserId);
    const knowledgeContext = await getKnowledgeContext(req.user.id, companyId);
    const userInstructions = await getCustomInstructions(req.user.id);
    const companyScenario  = await getCompanyScenario(req.user.id, companyId);
    const recruiterContext = await getRecruiterContext(recruiterId, effectiveUserId);

    const roleLabel = await resolveRoleLabel(role);
    const toneLabel = TONES[tone] || tone;
    const candidateContext = buildCandidateContext(candidate);

    // ── System prompt: who the AI is + all context ────────────────────────────
    // Priority order (last = highest): knowledge base → recruiter/candidate profile → company scenario → custom instructions
    const systemPrompt = [
      `You are an expert technical recruiter and interview coach specialising in ${roleLabel} roles.`,
      // 4. Knowledge base (lowest priority)
      knowledgeContext
        ? `${knowledgeContext}\n\nIMPORTANT: You MUST base the interview scenario and questions directly on the requirements, technologies, and criteria described in the knowledge base above. Do not generate generic questions — tailor everything to the specifics found in those documents.`
        : '',
      // 3. Recruiter & candidate profile
      recruiterContext,
      candidateContext ? `\n\n--- CANDIDATE TO INTERVIEW ---\n${candidateContext}` : '',
      // 2. Company interview framework/scenario
      companyScenario
        ? `\n\n=== COMPANY INTERVIEW FRAMEWORK ===\n${companyScenario}\n=== END ===`
        : '',
      // 1. Custom instructions (highest priority — placed last)
      userInstructions
        ? `\n\n=== CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — FOLLOW THESE ABOVE ALL ELSE) ===\n${userInstructions}\n=== END ===`
        : '',
    ].filter(Boolean).join('');

    // ── User prompt: what to generate ─────────────────────────────────────────
    // If a company scenario exists, the AI must follow it — no hardcoded structure
    // If no scenario, use a sensible default structure
    const hasCompanyScenario = !!companyScenario;

    const userPrompt = hasCompanyScenario
      ? [
          `Generate a complete interview scenario for the ${roleLabel} position following the INTERVIEW SCENARIO structure defined in your instructions EXACTLY.`,
          `Interview Goal: ${goal || 'Assess technical competency and cultural fit'}`,
          `Tone: ${toneLabel}`,
          candidateContext ? 'Personalise the questions based on the candidate profile provided.' : '',
          customInstructions ? `\nAdditional Instructions:\n${customInstructions}` : '',
          '\nDo NOT use a different structure. Follow the defined scenario precisely.',
        ].filter(Boolean).join('\n')
      : [
          `Generate a comprehensive, structured interview scenario for a ${roleLabel} position.`,
          candidateContext ? 'Personalise all questions and assessments for the candidate profile.' : '',
          `\nInterview Goal: ${goal || 'Assess technical competency and cultural fit'}`,
          `Tone: ${toneLabel}`,
          customInstructions ? `\nAdditional Instructions:\n${customInstructions}` : '',
          userInstructions ? '' : `
Structure the scenario with:
1. **Interview Overview** — context and objectives
2. **Opening Questions** (3-4) — warm-up and background
3. **Technical Assessment** (5-7 role-specific questions with expected answers)
4. **Behavioral Questions** (3-4) — situation-based
5. **Culture & Motivation** (2-3 questions)
6. **Closing** — questions to offer the candidate, next steps
7. **Evaluation Rubric** — key criteria and scoring`,
        ].filter(Boolean).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 3000,
      temperature: 0.7,
    });

    const scenario = completion.choices[0].message.content;
    if (candidate) {
      const existing = candidate.interviewScenarios || [];
      if (existing.length > 0) {
        await Candidate.updateScenario(candidateId, 0, scenario);
      } else {
        await Candidate.pushScenario(candidateId, { content: scenario, role: roleLabel });
      }
    }
    res.json({ scenario, role: roleLabel, candidateId });
  } catch (err) {
    console.error('[Generate scenario]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate/outreach ───────────────────────────────────────────────────
router.post('/outreach', async (req, res) => {
  try {
    const { candidateId, role, messageType = 'outreach', tone = 'professional', goal, customInstructions, recruiterId, companyId: companyIdOverride } = req.body;

    const MESSAGE_TYPE_LABELS = {
      outreach:  'initial outreach',
      screening: 'screening interview invitation',
      technical: 'technical interview invitation',
      followup:  'follow-up',
    };

    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (!Candidate.canAccess(candidate, req.user)) candidate = null;
    }

    const effectiveUserId  = await getEffectiveUserId(req, candidateId);
    const companyId        = companyIdOverride ?? candidate?.companyId ?? null;
    const openai           = await getOpenAIClient(effectiveUserId);
    const knowledgeContext = await getKnowledgeContext(req.user.id, companyId);
    const userInstructions = await getCustomInstructions(req.user.id);
    const recruiterContext = await getRecruiterContext(recruiterId, effectiveUserId);

    const roleLabel     = await resolveRoleLabel(role);
    const toneLabel     = TONES[tone] || tone;
    const messageLabel  = MESSAGE_TYPE_LABELS[messageType] || messageType;
    const candidateContext = buildCandidateContext(candidate, 1000);

    // Priority order (last = highest): knowledge base → recruiter/candidate profile → custom instructions
    const systemPrompt = [
      `You are an expert recruiter writing ${messageLabel} messages for ${roleLabel} positions.`,
      // 4. Knowledge base (lowest priority)
      knowledgeContext,
      // 3. Recruiter & candidate profile
      recruiterContext,
      candidateContext ? `\n\n--- CANDIDATE ---\n${candidateContext}` : '',
      // 1. Custom instructions (highest priority — placed last)
      userInstructions
        ? `\n\n=== CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — FOLLOW THESE ABOVE ALL ELSE) ===\n${userInstructions}\n=== END ===`
        : '',
    ].filter(Boolean).join('');

    const userPrompt = [
      `Write a compelling, personalised ${messageLabel} message for a ${roleLabel} position.`,
      `Goal: ${goal || 'Connect with the candidate and initiate a conversation about the opportunity'}`,
      `Tone: ${toneLabel}`,
      candidateContext ? 'Personalise the message using the candidate profile above — reference specific details from their background.' : '',
      customInstructions ? `\nAdditional Instructions:\n${customInstructions}` : '',
      `
Requirements:
- Feel genuine and human, not templated
- Clearly communicate the opportunity and value proposition
- Include a clear call-to-action
- Format with Subject line followed by message body`,
    ].filter(Boolean).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const message = completion.choices[0].message.content;
    if (candidate) {
      const existing = candidate.outreachMessages || [];
      if (existing.length > 0) {
        await Candidate.updateOutreachMessage(candidateId, 0, message);
      } else {
        await Candidate.pushOutreachMessage(candidateId, { content: message, type: messageType });
      }
    }
    res.json({ message, role: roleLabel, candidateId });
  } catch (err) {
    console.error('[Generate outreach]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate/conversation ───────────────────────────────────────────────
router.post('/conversation', async (req, res) => {
  try {
    const {
      candidateId, candidateReply, role, tone = 'professional',
      history = [], recruiterId, customInstructions, imageBase64, imageMimeType,
      attachedFileName, attachedFileText, companyId: companyIdOverride,
    } = req.body;

    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (!Candidate.canAccess(candidate, req.user)) candidate = null;
    }

    const effectiveUserId  = await getEffectiveUserId(req, candidateId);
    const companyId        = companyIdOverride ?? candidate?.companyId ?? null;
    const openai           = await getOpenAIClient(effectiveUserId);
    const knowledgeContext = await getKnowledgeContext(req.user.id, companyId);
    const userInstructions = await getCustomInstructions(req.user.id);
    const companyScenario  = await getCompanyScenario(req.user.id, companyId);
    const recruiterContext = await getRecruiterContext(recruiterId, effectiveUserId);

    const roleLabel    = await resolveRoleLabel(role);
    const toneLabel    = TONES[tone] || tone;

    // Applied scenario on this specific candidate (set via Apply to Conversation)
    const appliedScenario = candidate?.appliedScenario || '';

    // Priority order (last = highest): knowledge base → recruiter/candidate profile → company scenario → candidate scenario → custom instructions
    const systemPrompt = [
      `You are an expert recruiter conducting a ${roleLabel} interview conversation.`,
      `Maintain a ${toneLabel} tone throughout. Generate the next ideal recruiter response.`,
      `Be natural, engaging, concise and move the conversation forward productively.`,
      `\nIf the candidate sent an image, describe what you observe and respond appropriately.`,
      // 4. Knowledge base (lowest priority)
      knowledgeContext
        ? `${knowledgeContext}\n\nIMPORTANT: You MUST use the knowledge base above as the foundation for your interview questions and responses. Ask the candidate specifically about the technologies, requirements, and criteria described in those documents. Do not rely on generic interview questions.`
        : '',
      // 3. Recruiter & candidate profile
      recruiterContext,
      candidate ? `\n\n--- CANDIDATE ---\n${buildCandidateContext(candidate, 1500)}` : '',
      // 2a. Company interview framework/scenario
      companyScenario
        ? `\n\n=== COMPANY INTERVIEW FRAMEWORK ===\n${companyScenario}\n=== END ===`
        : '',
      // 2b. Per-candidate applied scenario (overrides company scenario)
      appliedScenario
        ? `\n\n=== CANDIDATE INTERVIEW SCENARIO (FOLLOW THIS) ===\n${appliedScenario}\n=== END ===`
        : '',
      // 1. Custom instructions (highest priority — placed last)
      userInstructions
        ? `\n\n=== CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — FOLLOW THESE ABOVE ALL ELSE) ===\n${userInstructions}\n=== END ===`
        : '',
      customInstructions
        ? `\n\n=== SESSION INSTRUCTIONS (OVERRIDE ALL — FOLLOW EXACTLY) ===\n${customInstructions}\n=== END ===`
        : '',
    ].filter(Boolean).join('');

    // Combine file text + typed content for a history entry (for AI context)
    const buildMsgContent = (h) => {
      const filePrefix = h.attachedFileText
        ? `[Attached file: ${h.attachedFileName || 'file'}]\n\n${h.attachedFileText}`
        : '';
      const typed = h.content || '';
      return [filePrefix, typed].filter(Boolean).join('\n\n') || '';
    };

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.filter(h => h.role !== 'call_script').map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.imageBase64
          ? [
              { type: 'image_url', image_url: { url: `data:${h.imageMimeType || 'image/jpeg'};base64,${h.imageBase64}` } },
              ...(buildMsgContent(h) ? [{ type: 'text', text: buildMsgContent(h) }] : []),
            ]
          : buildMsgContent(h),
      })),
    ];

    // Build current user message content for AI
    const currentFilePrefix = attachedFileText
      ? `[Attached file: ${attachedFileName || 'file'}]\n\n${attachedFileText}`
      : '';
    const currentContent = [currentFilePrefix, candidateReply].filter(Boolean).join('\n\n');

    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}` } },
          ...(currentContent ? [{ type: 'text', text: currentContent }] : []),
        ],
      });
    } else if (currentContent) {
      messages.push({ role: 'user', content: currentContent });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 800,
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;

    if (candidate) {
      const entries = [];
      if (imageBase64 || candidateReply || attachedFileText) {
        entries.push({
          role: 'user',
          content: candidateReply || '',
          imageBase64: imageBase64 || null,
          imageMimeType: imageMimeType || null,
          attachedFileName: attachedFileName || null,
          attachedFileText: attachedFileText || null,
          fromCandidate: false, // recruiter context/prompt, not an actual candidate reply
        });
      }
      entries.push({ role: 'assistant', content: response });
      await Candidate.pushConversation(candidateId, entries);

      // Auto-advance status: pending → in_progress when conversation starts
      if (candidate.status === 'pending') {
        await Candidate.update(candidateId, { status: 'in_progress' });
      }

      // Notify the candidate's owner when someone else replies in their conversation
      if (candidate.ownerId && candidate.ownerId !== req.user.id) {
        try {
          const Notification = require('../models/Notification');
          await Notification.create({
            userId:          candidate.ownerId,
            type:            'conversation',
            title:           'New conversation reply',
            message:         `${req.user.displayName || req.user.username} replied in ${candidate.fullName || 'a candidate'}\u2019s conversation.`,
            candidateId:     candidateId,
            candidateName:   candidate.fullName || '',
            createdBy:       req.user.id,
            createdByName:   req.user.displayName || req.user.username,
          });
        } catch (_) { /* non-critical */ }
      }
    }

    res.json({ response });
  } catch (err) {
    console.error('[Generate conversation]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate/recommend-role ─────────────────────────────────────────────
router.post('/recommend-role', async (req, res) => {
  try {
    const { resumeText, candidateId } = req.body;
    const openai = await getOpenAIClient(req.user.id);

    let text = resumeText || '';
    if (!text && candidateId) {
      const candidate = await Candidate.findById(candidateId);
      if (candidate && Candidate.canAccess(candidate, req.user)) text = candidate.resumeText || '';
    }

    const { isConnected } = require('../utils/firebase');
    let rolesContext = '';
    if (isConnected()) {
      const Settings = require('../models/Settings');
      const customRoles = await Settings.get('custom_roles');
      if (customRoles && Array.isArray(customRoles)) {
        rolesContext = customRoles.map(r => `- ${r.value}: ${r.label}`).join('\n');
      }
    }
    if (!rolesContext) {
      rolesContext = Object.entries(DEFAULT_ROLES).map(([v, l]) => `- ${v}: ${l}`).join('\n');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert technical recruiter. Analyse a candidate profile and recommend the most suitable role. Return ONLY valid JSON.' },
        { role: 'user', content: `Based on this resume, recommend the best matching role from the list.\n\nAvailable roles:\n${rolesContext}\n\nResume:\n${text.substring(0, 3000)}\n\nReturn JSON: { "roleValue": "the_role_value", "recommendedRole": "The Role Label", "confidence": "high|medium|low", "reasoning": "brief explanation" }` },
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);
  } catch (err) {
    console.error('[Recommend role]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate/call-script ───────────────────────────────────────────────
// Returns JSON { script } — client saves it as a conversation message then
// downloads a PDF via /export-pdf when the user clicks ↓ PDF.
router.post('/call-script', async (req, res) => {
  try {
    const {
      candidateId, history = [],
      role, customInstructions = '', companyId: companyIdOverride, recruiterId,
    } = req.body;

    let candidate = null;
    if (candidateId) {
      candidate = await Candidate.findById(candidateId);
      if (!Candidate.canAccess(candidate, req.user)) candidate = null;
    }

    const effectiveUserId  = await getEffectiveUserId(req, candidateId);
    const companyId        = companyIdOverride ?? candidate?.companyId ?? null;
    const openai           = await getOpenAIClient(effectiveUserId);
    const knowledgeContext = await getKnowledgeContext(req.user.id, companyId);
    const userInstructions = await getCustomInstructions(req.user.id);
    const companyScenario  = await getCompanyScenario(req.user.id, companyId);
    const recruiterContext = await getRecruiterContext(recruiterId, effectiveUserId);
    const roleLabel        = await resolveRoleLabel(role || candidate?.role);
    const candidateContext = buildCandidateContext(candidate, 1500);

    // Look up company name for the intro
    let companyIntro = '';
    if (companyId) {
      try {
        const Settings = require('../models/Settings');
        const companies = await Settings.get('companies');
        const company = Array.isArray(companies) ? companies.find(c => c.id === companyId) : null;
        if (company?.name) {
          companyIntro = `\n\n--- COMPANY ---\nCompany: ${company.name}${company.description ? `\n${company.description}` : ''}`;
        }
      } catch (_) {}
    }

    // Summarise conversation history for context (skip call_script entries)
    const convoSummary = history
      .filter(h => h.role !== 'call_script' && h.content)
      .slice(-20) // last 20 messages
      .map(h => `${h.role === 'assistant' ? 'Recruiter' : 'Candidate'}: ${h.content}`)
      .join('\n');

    // Priority order (last = highest): knowledge base → recruiter/candidate profile → company scenario → custom instructions
    const systemPrompt = [
      `You are an expert recruiter writing a structured phone/video call script for a ${roleLabel || 'professional'} position.`,
      // 4. Knowledge base (lowest priority)
      knowledgeContext,
      // 3. Recruiter & candidate profile
      companyIntro,
      recruiterContext,
      candidateContext ? `\n\n--- CANDIDATE ---\n${candidateContext}` : '',
      // 2. Company interview framework/scenario
      companyScenario
        ? `\n\n=== COMPANY INTERVIEW FRAMEWORK ===\n${companyScenario}\n=== END ===`
        : '',
      // 1. Custom instructions (highest priority — placed last)
      userInstructions
        ? `\n\n=== CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — FOLLOW THESE ABOVE ALL ELSE) ===\n${userInstructions}\n=== END ===`
        : '',
    ].filter(Boolean).join('');

    const userPrompt = [
      `Generate a detailed, structured call script for the next recruiter call with this candidate, based on the conversation so far.`,
      convoSummary ? `\n\n--- CONVERSATION SO FAR ---\n${convoSummary}\n---` : '',
      customInstructions ? `\n\nCustom Instructions:\n${customInstructions}` : '',
      `\n\nStructure the call script with these sections:
## 1. Opening
How to greet and set the tone for the call.

## 2. Purpose of the Call
What you'll cover and why you're calling.

## 3. Key Talking Points
Bullet points tailored to the current conversation stage and candidate profile.

## 4. Questions to Ask
5-7 targeted questions for this specific stage of the conversation.

## 5. Handling Common Responses
How to address hesitation, competing offers, or pushback.

## 6. Closing
How to wrap up, confirm next steps, and keep momentum.

Make it natural, specific, and easy to follow live on a call.`,
    ].filter(Boolean).join('');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    });

    const script = completion.choices[0].message.content;

    // Save to conversation history as a call_script entry
    if (candidate) {
      await Candidate.pushConversation(candidateId, [{
        role: 'call_script',
        content: script,
      }]);
    }

    res.json({ script });
  } catch (err) {
    console.error('[Call script]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate/export-pdf ─────────────────────────────────────────────────
router.post('/export-pdf', async (req, res) => {
  try {
    const { content, title = 'Document', candidateName } = req.body;
    const doc = new PDFDocument({ margin: 50 });
    // Sanitize filename: strip non-ASCII and unsafe chars for Content-Disposition
    const safeFilename = (title || 'Document')
      .replace(/[^\x00-\x7F]/g, '')   // strip non-ASCII (em dashes etc.)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_.-]/g, '') || 'document';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
    if (candidateName) {
      doc.fontSize(12).font('Helvetica').moveDown(0.3).text(`Candidate: ${candidateName}`, { align: 'center' });
    }
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown().fontSize(11).font('Helvetica').text(content, { lineGap: 4 });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
