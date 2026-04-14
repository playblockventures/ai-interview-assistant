const express   = require('express');
const router    = express.Router();
const Candidate = require('../models/Candidate');
const { requireAuth } = require('../utils/auth');

router.use(requireAuth);

const getOwned = async (req, id) => {
  const c = await Candidate.findById(id);
  if (!c) return [null, 'Candidate not found', 404];
  if (!Candidate.canAccess(c, req.user)) return [null, 'Access denied', 403];
  return [c, null, 200];
};

// GET history
router.get('/:candidateId', async (req, res) => {
  try {
    const [c, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { fullName, email, role, outreachMessages, interviewScenarios, conversationHistory } = c;
    res.json({ id: c.id, fullName, email, role, outreachMessages, interviewScenarios, conversationHistory });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Conversation ────────────────────────────────────────────────────────────────

// DELETE all
router.delete('/:candidateId/conversation', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    await Candidate.clearConversation(req.params.candidateId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — manually add a message to conversation
router.post('/:candidateId/conversation', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { role, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    if (!['user', 'assistant', 'call_script'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await Candidate.pushConversation(req.params.candidateId, [{ role, content: content.trim() }]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE single message
router.delete('/:candidateId/conversation/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    await Candidate.deleteConversationMessage(req.params.candidateId, parseInt(req.params.index));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH — edit a single conversation message
router.patch('/:candidateId/conversation/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    await Candidate.updateConversationMessage(req.params.candidateId, parseInt(req.params.index), content.trim());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Outreach ────────────────────────────────────────────────────────────────────

// POST — manually add an outreach message
router.post('/:candidateId/outreach', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { content, type = 'manual' } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    await Candidate.pushOutreachMessage(req.params.candidateId, { content: content.trim(), type });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE single outreach message
router.delete('/:candidateId/outreach/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    await Candidate.deleteOutreachMessage(req.params.candidateId, parseInt(req.params.index));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH — edit a single outreach message
router.patch('/:candidateId/outreach/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    await Candidate.updateOutreachMessage(req.params.candidateId, parseInt(req.params.index), content.trim());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scenario ────────────────────────────────────────────────────────────────────

// PATCH — edit a single scenario
router.patch('/:candidateId/scenario/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    await Candidate.updateScenario(req.params.candidateId, parseInt(req.params.index), content.trim());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:candidateId/scenario/:index', async (req, res) => {
  try {
    const [, err, code] = await getOwned(req, req.params.candidateId);
    if (err) return res.status(code).json({ error: err });
    await Candidate.deleteScenario(req.params.candidateId, parseInt(req.params.index));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
