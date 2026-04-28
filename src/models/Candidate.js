const { getDB } = require('../utils/firebase');
const { normalizeCountry } = require('../utils/locationNormalize');

const COL = 'candidates';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

// Fields fetched for the list view — excludes large payload fields
const LIST_FIELDS = [
  'fullName', 'email', 'phone', 'location', 'currentTitle', 'linkedinUrl',
  'photoUrl', 'role', 'recruiterId', 'recruiterName', 'companyId', 'companyName',
  'ownerId', 'ownerName', 'status', 'notes', 'resumeUrl', 'resumeFileName',
  'appliedScenario', 'createdAt', 'updatedAt', 'lastMessageAt',
  'avgResponseMs', 'candidateMessageCount', 'engagementScore', 'engagementLabel',
  'aiEngagementScore', 'combinedEngagementScore',
];

// Compute engagement metrics from conversationHistory — same filter rules as findActiveWithResponseTime
function isValidCandidateMsg(m) {
  if (m.role !== 'user') return false;
  const content = (m.content || '').trim();
  if (/^\[.*\]$/.test(content) || content === '.') return false;
  return true;
}

function engagementLabelFromScore(score) {
  if (score >= 8.5) return 'Very Active';
  if (score >= 6.5) return 'Active';
  if (score >= 4.5) return 'Engaged';
  if (score >= 2.5) return 'Passive';
  return 'Unresponsive';
}

function computeEngagement(conversationHistory) {
  const history = conversationHistory || [];

  const validMsgs = history.filter(isValidCandidateMsg);
  const candidateMessageCount = validMsgs.length;

  // Only use messages with valid timestamps for gap calculation
  const timestampedTimes = validMsgs
    .map(m => new Date(m.timestamp || m.createdAt || 0).getTime())
    .filter(ms => ms > 0)
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < timestampedTimes.length; i++) {
    gaps.push(timestampedTimes[i] - timestampedTimes[i - 1]);
  }

  const avgResponseMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

  // Base score 1–5
  let engagementScore = 1;
  const avgH = avgResponseMs !== null ? avgResponseMs / 3600000 : Infinity;

  if      (candidateMessageCount >= 10 && avgH < 1)  engagementScore = 5;
  else if (candidateMessageCount >= 5  && avgH < 4)  engagementScore = 4;
  else if (candidateMessageCount >= 3  && avgH < 24) engagementScore = 3;
  else if (candidateMessageCount >= 1)               engagementScore = 2;

  // Count consecutive unanswered recruiter messages at the END of conversation
  const conversationMsgs = history.filter(m => m.role === 'user' || m.role === 'assistant');
  let unrepliedRecruiterCount = 0;
  for (let i = conversationMsgs.length - 1; i >= 0; i--) {
    if (conversationMsgs[i].role === 'assistant') unrepliedRecruiterCount++;
    else break;
  }

  // Penalty multiplier: each unanswered recruiter message reduces the score
  let noReplyPenalty = 1;
  if      (unrepliedRecruiterCount >= 3) noReplyPenalty = 0.2;
  else if (unrepliedRecruiterCount === 2) noReplyPenalty = 0.5;
  else if (unrepliedRecruiterCount === 1) noReplyPenalty = 0.8;

  // Normalize base score to 1–10 scale, apply penalty
  const baseNormalized = Math.max(1, ((engagementScore - 1) / 4 * 9 + 1) * noReplyPenalty);
  const engagementLabel = engagementLabelFromScore(baseNormalized);

  return { avgResponseMs, candidateMessageCount, engagementScore, engagementLabel, noReplyPenalty };
}

// Compute combined score synchronously using base score + existing AI score (if any)
function computeCombined(engagementScore, existingAiScore, noReplyPenalty = 1) {
  const baseNormalized = Math.max(1, ((engagementScore - 1) / 4 * 9 + 1) * noReplyPenalty);
  let combined;
  if (existingAiScore != null) {
    combined = baseNormalized * 0.5 + existingAiScore * 0.5;
  } else {
    combined = baseNormalized;
  }
  // Apply no-reply penalty to the full combined score too
  return Math.round(Math.max(1, combined * noReplyPenalty) * 100) / 100;
}

// Persist computed engagement to Firestore and trigger AI analysis
async function persistEngagement(id, db, history, ownerId) {
  const doc = await db.collection(COL).doc(id).get();
  const existingAiScore = doc.data()?.aiEngagementScore ?? null;
  const engagement = computeEngagement(history);
  const combined = computeCombined(engagement.engagementScore, existingAiScore, engagement.noReplyPenalty);
  await db.collection(COL).doc(id).update({
    candidateMessageCount:   engagement.candidateMessageCount,
    engagementScore:         engagement.engagementScore,
    avgResponseMs:           engagement.avgResponseMs,
    combinedEngagementScore: combined,
    engagementLabel:         engagementLabelFromScore(combined),
    updatedAt:               now(),
  });
  if (engagement.candidateMessageCount >= 1) {
    analyzeEngagementWithAI(id, history, engagement, ownerId).catch(() => {});
  }
}

// AI-powered deep engagement analysis — fire-and-forget, persists aiEngagementScore + combinedEngagementScore
async function analyzeEngagementWithAI(id, history, baseEngagement, ownerId) {
  try {
    const candidateMessages = history
      .filter(m => {
        if (m.role !== 'user') return false;
        const content = (m.content || '').trim();
        return !(/^\[.*\]$/.test(content) || content === '.');
      })
      .map(m => m.content || '')
      .filter(Boolean)
      .slice(-20); // analyse most recent 20 messages

    if (candidateMessages.length < 1) return;

    const { getOpenAIClient } = require('../utils/openai');
    const openai = await getOpenAIClient(ownerId);

    const prompt = `You are an expert recruiter analyst. Analyse the following candidate's messages from a recruitment conversation and rate their engagement level.

Candidate messages (chronological order):
${candidateMessages.map((m, i) => `[${i + 1}] ${m}`).join('\n\n')}

Score the candidate's engagement from 1.0 to 10.0 (decimal allowed) based on:
- Depth and length of responses (are they elaborating or giving one-word answers?)
- Enthusiasm and positivity (exclamation, positive language, interest in the role)
- Proactiveness (do they ask questions, volunteer extra information?)
- Consistency and responsiveness (message quality across multiple replies)
- Specificity (are they referencing details about the role/company, or generic?)

Respond with ONLY a JSON object in this exact format:
{"score": <number 1.0-10.0>, "reasoning": "<one sentence>"}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const aiScore = Math.min(10, Math.max(1, parseFloat(parsed.score) || 5));

    // Normalize base score (1–5) to 1–10 scale, apply no-reply penalty, then blend
    const noReplyPenalty = baseEngagement.noReplyPenalty ?? 1;
    const baseNormalized = Math.max(1, ((baseEngagement.engagementScore - 1) / 4 * 9 + 1) * noReplyPenalty);
    const combined = Math.round(Math.max(1, (baseNormalized * 0.5 + aiScore * 0.5) * noReplyPenalty) * 100) / 100;

    const db = getDB();
    await db.collection(COL).doc(id).update({
      aiEngagementScore:       aiScore,
      aiEngagementReasoning:   parsed.reasoning || '',
      combinedEngagementScore: combined,
      engagementLabel:         engagementLabelFromScore(combined),
      updatedAt: now(),
    });
  } catch (_) {}
}

const Candidate = {
  // Fetch list using field projection — avoids downloading huge resumeText/conversationHistory
  async findAll({ status, search, page = 1, limit = 20, recruiterId, ownerId, isAdmin, ids, excludeIds, fromDate, toDate, engagementLabel } = {}) {
    const db = getDB();

    // Use .select() so Firestore only returns the fields we need for the list view
    let query = db.collection(COL).select(...LIST_FIELDS);

    // Push ownership and status filters to Firestore
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    if (status) {
      const statusArr = status.split(',').filter(Boolean);
      query = statusArr.length === 1
        ? query.where('status', '==', statusArr[0])
        : query.where('status', 'in', statusArr);
    }

    const snapshot = await query.get();
    let docs = snapshot.docs.map(docToObj);

    // If specific IDs requested (e.g. pinned candidates fetch), filter and preserve order
    if (ids && ids.length) {
      const idSet = new Set(ids);
      docs = ids.map(id => docs.find(d => d.id === id)).filter(Boolean);
      return { candidates: docs, total: docs.length, page: 1, totalPages: 1 };
    }

    docs.sort((a, b) => {
      const aTime = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bTime = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });

    if (fromDate || toDate) {
      const from = fromDate ? new Date(fromDate).getTime() : 0;
      const to   = toDate   ? new Date(toDate + 'T23:59:59.999Z').getTime() : Infinity;
      docs = docs.filter(d => {
        const t = new Date(d.createdAt || 0).getTime();
        return t >= from && t <= to;
      });
    }
    if (excludeIds && excludeIds.length) {
      const excludeSet = new Set(excludeIds);
      docs = docs.filter(d => !excludeSet.has(d.id));
    }
    if (recruiterId) docs = docs.filter(d => d.recruiterId === recruiterId);
    if (engagementLabel) {
      const labelSet = new Set(engagementLabel.split(',').map(l => l.trim()).filter(Boolean));
      docs = docs.filter(d => {
        const s = d.combinedEngagementScore ?? ((d.engagementScore || 1) - 1) / 4 * 9 + 1;
        const derived = s >= 8.5 ? 'Very Active' : s >= 6.5 ? 'Active' : s >= 4.5 ? 'Engaged' : s >= 2.5 ? 'Passive' : 'Unresponsive';
        return labelSet.has(derived);
      });
    }
    if (search) {
      const s = search.toLowerCase();
      docs = docs.filter(d =>
        (d.fullName      || '').toLowerCase().includes(s) ||
        (d.email         || '').toLowerCase().includes(s) ||
        (d.role          || '').toLowerCase().includes(s) ||
        (d.location      || '').toLowerCase().includes(s) ||
        (d.currentTitle  || '').toLowerCase().includes(s) ||
        (d.recruiterName || '').toLowerCase().includes(s)
      );
    }

    const total = docs.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paginated = docs.slice(start, start + parseInt(limit));
    return { candidates: paginated, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) };
  },

  // Lightweight stats for the dashboard — only reads small projection fields
  async getStats({ ownerId, isAdmin } = {}) {
    const db = getDB();
    const STAT_FIELDS = ['fullName', 'email', 'photoUrl', 'status', 'role', 'location',
                         'recruiterId', 'recruiterName', 'ownerId', 'ownerName',
                         'companyId', 'companyName', 'createdAt', 'updatedAt', 'lastMessageAt'];
    let query = db.collection(COL).select(...STAT_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    return snapshot.docs.map(docToObj);
  },

  // Server-side analytics computation — replaces client-side useMemo for dashboard
  async computeAnalytics({ ownerId, isAdmin, fromDate, toDate } = {}) {
    const db = getDB();
    const ANALYTICS_FIELDS = [
      'fullName', 'email', 'photoUrl', 'currentTitle', 'status', 'role', 'location',
      'recruiterId', 'recruiterName', 'ownerId', 'ownerName',
      'companyId', 'companyName', 'createdAt', 'updatedAt', 'lastMessageAt',
    ];
    const FAILED_STATUSES = ['failed', 'no_response', 'not_interested', 'other_job', 'have_a_doubt', 'dangerous'];

    let query = db.collection(COL).select(...ANALYTICS_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    const allDocs = snapshot.docs.map(docToObj);

    // ── Duplicate detection — always unscoped (cross-user visibility) ──────
    const allDocsForDupes = ownerId
      ? (await db.collection(COL).select(...ANALYTICS_FIELDS).get()).docs.map(docToObj)
      : allDocs;

    // ── Stale candidates (unfiltered — operational alert) ──────────────────
    const staleCandidates = allDocs
      .filter(c => {
        if (c.status !== 'in_progress') return false;
        const last = c.lastMessageAt || c.createdAt;
        return (Date.now() - new Date(last)) / (1000 * 60 * 60 * 24) > 3;
      })
      .sort((a, b) => {
        const ad = (Date.now() - new Date(a.lastMessageAt || a.createdAt)) / 86400000;
        const bd = (Date.now() - new Date(b.lastMessageAt || b.createdAt)) / 86400000;
        return bd - ad;
      });

    // ── Duplicate groups — cross-user, only shown when current user has stake ─
    const nameMap = {}, emailMap = {};
    allDocsForDupes.forEach(c => {
      const name  = (c.fullName || '').toLowerCase().trim();
      const email = (c.email    || '').toLowerCase().trim();
      if (name)  { if (!nameMap[name])   nameMap[name]  = []; nameMap[name].push(c);  }
      if (email) { if (!emailMap[email]) emailMap[email] = []; emailMap[email].push(c); }
    });
    const seenKeys = new Set();
    const duplicateGroups = [];
    const addGroup = (group, reason) => {
      if (group.length < 2) return;
      const key = group.map(c => c.id).sort().join(',');
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      const UNDECIDED = new Set(['pending', 'in_progress']);
      if (!group.some(c => UNDECIDED.has(c.status))) return;
      // For scoped users: only include groups where at least one candidate belongs to them
      if (ownerId && !group.some(c => c.ownerId === ownerId)) return;
      duplicateGroups.push({ reason, value: group[0][reason === 'name' ? 'fullName' : 'email'], candidates: group });
    };
    Object.values(nameMap).forEach(g  => addGroup(g, 'name'));
    Object.values(emailMap).forEach(g => addGroup(g, 'email'));

    // ── Monthly trend (unfiltered — historical view) ───────────────────────
    const now = new Date();
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const d    = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = allDocs.filter(c => { const cd = new Date(c.createdAt); return cd >= d && cd < next; }).length;
      return { label: d.toLocaleDateString('en', { month: 'short' }), value: count };
    });

    // ── Weekly activity (unfiltered — last 8 weeks) ────────────────────────
    const weeklyActivity = Array.from({ length: 8 }, (_, w) => {
      const wIdx = 7 - w;
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - wIdx * 7); weekStart.setHours(0, 0, 0, 0);
      const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
      const count = allDocs.filter(c => { const d = new Date(c.createdAt); return d >= weekStart && d < weekEnd; }).length;
      const label = wIdx === 0 ? 'This week' : wIdx === 1 ? 'Last week' : `${wIdx}w ago`;
      return { label, count };
    });

    // ── Apply date filter for aggregate stats ──────────────────────────────
    let docs = allDocs;
    if (fromDate || toDate) {
      const from = fromDate ? new Date(fromDate).getTime() : 0;
      const to   = toDate   ? new Date(toDate + 'T23:59:59.999Z').getTime() : Infinity;
      docs = allDocs.filter(c => {
        const t = new Date(c.createdAt || 0).getTime();
        return t >= from && t <= to;
      });
    }

    const total = docs.length;

    // Status counts
    const statusCounts = { pending: 0, in_progress: 0, success: 0, failed: 0, no_response: 0, not_interested: 0, other_job: 0, have_a_doubt: 0, dangerous: 0 };
    docs.forEach(c => { if (statusCounts[c.status] !== undefined) statusCounts[c.status]++; });
    const totalFailed = FAILED_STATUSES.reduce((sum, s) => sum + (statusCounts[s] || 0), 0);
    const conversionRate = total > 0 ? Math.round((statusCounts.success / total) * 100) : 0;
    const decided = statusCounts.success + totalFailed;
    const successRate = decided > 0 ? Math.round((statusCounts.success / decided) * 100) : 0;

    // Role breakdown — top 6 (raw values; client resolves label from roles list)
    const roleCounts = {};
    docs.forEach(c => { if (c.role) roleCounts[c.role] = (roleCounts[c.role] || 0) + 1; });
    const roleBreakdown = Object.entries(roleCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([roleValue, value]) => ({ roleValue, value }));

    // Location breakdown — normalized, top 6
    const locCounts = {};
    docs.forEach(c => {
      const country = normalizeCountry(c.location);
      if (country) locCounts[country] = (locCounts[country] || 0) + 1;
    });
    const locationBreakdown = Object.entries(locCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([label, value]) => ({ label, value }));

    // Recruiter performance — top 6
    const recruiterStats = {};
    docs.forEach(c => {
      if (!c.recruiterId) return;
      if (!recruiterStats[c.recruiterId]) {
        recruiterStats[c.recruiterId] = { name: c.recruiterName || 'Unknown', total: 0, success: 0, in_progress: 0, pending: 0, failed: 0 };
      }
      recruiterStats[c.recruiterId].total++;
      const rKey = FAILED_STATUSES.includes(c.status) ? 'failed' : c.status;
      if (recruiterStats[c.recruiterId][rKey] !== undefined) recruiterStats[c.recruiterId][rKey]++;
    });
    const recruiterPerf = Object.entries(recruiterStats)
      .map(([id, s]) => ({ id, ...s, successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total).slice(0, 6);

    // Avg time to decision (days)
    const completed = docs.filter(c => (c.status === 'success' || FAILED_STATUSES.includes(c.status)) && c.createdAt && c.updatedAt);
    const avgDays = completed.length > 0
      ? Math.round(completed.reduce((sum, c) => sum + (new Date(c.updatedAt) - new Date(c.createdAt)) / 86400000, 0) / completed.length)
      : null;

    // User (hiring manager) breakdown
    const userStats = {};
    docs.forEach(c => {
      const key = c.ownerId || '__none__';
      if (!userStats[key]) userStats[key] = { id: c.ownerId || null, name: c.ownerName || 'Unknown', total: 0, success: 0, in_progress: 0 };
      userStats[key].total++;
      if (userStats[key][c.status] !== undefined) userStats[key][c.status]++;
    });
    const userBreakdown = Object.values(userStats)
      .map(s => ({ ...s, successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    return {
      total, statusCounts, totalFailed, conversionRate, successRate,
      roleBreakdown, locationBreakdown, recruiterPerf, avgDays,
      monthlyTrend, weeklyActivity, userBreakdown,
      staleCandidates, duplicateGroups,
    };
  },

  // Active candidates — uses persisted engagement fields, no full history load needed
  async findActiveWithResponseTime({ ownerId, isAdmin } = {}) {
    const db = getDB();
    const ACTIVE_FIELDS = [
      'fullName', 'email', 'photoUrl', 'currentTitle', 'role',
      'recruiterId', 'recruiterName', 'ownerId', 'ownerName', 'status',
      'lastMessageAt', 'createdAt', 'updatedAt',
      'avgResponseMs', 'candidateMessageCount', 'engagementScore', 'engagementLabel',
      'aiEngagementScore', 'aiEngagementReasoning', 'combinedEngagementScore',
    ];
    let query = db.collection(COL).where('status', '==', 'in_progress').select(...ACTIVE_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    const docs = snapshot.docs.map(docToObj);

    return docs
      .map(c => {
        const lastContactAt = c.lastMessageAt || c.updatedAt || c.createdAt;
        const durationSinceLastMessageMs = Date.now() - new Date(lastContactAt || 0).getTime();
        return { ...c, messageCount: c.candidateMessageCount || 0, durationSinceLastMessageMs };
      })
      .filter(c => {
        const s = c.combinedEngagementScore ?? ((c.engagementScore || 1) - 1) / 4 * 9 + 1;
        return s >= 6.5; // Active (6.5–8.5) or Very Active (8.5+)
      })
      .sort((a, b) => {
        const scoreA = a.combinedEngagementScore ?? ((a.engagementScore || 1) - 1) / 4 * 9 + 1;
        const scoreB = b.combinedEngagementScore ?? ((b.engagementScore || 1) - 1) / 4 * 9 + 1;
        return scoreB - scoreA || a.durationSinceLastMessageMs - b.durationSinceLastMessageMs;
      })
;
  },

  // Unscoped check — finds any dangerous candidate matching email or linkedinUrl across all users
  async checkDangerous({ email, linkedinUrl } = {}) {
    if (!email && !linkedinUrl) return null;
    const db = getDB();
    const snapshot = await db.collection(COL)
      .where('status', '==', 'dangerous')
      .select('fullName', 'email', 'linkedinUrl', 'status', 'ownerName')
      .get();
    const docs = snapshot.docs.map(docToObj);
    return docs.find(c =>
      (email      && c.email?.toLowerCase() === email.toLowerCase()) ||
      (linkedinUrl && c.linkedinUrl         === linkedinUrl)
    ) || null;
  },

  // Find cross-user duplicates for a single candidate (same name or email)
  async findDuplicates(id) {
    const db = getDB();
    const source = await db.collection(COL).doc(id).get();
    if (!source.exists) return [];
    const { fullName, email } = source.data();
    const normName  = (fullName || '').toLowerCase().trim();
    const normEmail = (email    || '').toLowerCase().trim();
    if (!normName && !normEmail) return [];

    const DUPE_FIELDS = ['fullName', 'email', 'currentTitle', 'photoUrl', 'status', 'ownerId', 'ownerName', 'recruiterId', 'recruiterName'];
    const snapshot = await db.collection(COL).select(...DUPE_FIELDS).get();
    const results = [];
    for (const doc of snapshot.docs) {
      if (doc.id === id) continue;
      const d = doc.data();
      const dName  = (d.fullName || '').toLowerCase().trim();
      const dEmail = (d.email    || '').toLowerCase().trim();
      const matchName  = normName  && dName  && dName  === normName;
      const matchEmail = normEmail && dEmail && dEmail === normEmail;
      if (matchName || matchEmail) {
        results.push({ id: doc.id, ...d, matchReason: matchEmail ? 'email' : 'name' });
      }
    }
    return results;
  },

  // Fetch just the N most recently active candidates (for dashboard recent list)
  async findRecent({ ownerId, isAdmin, limit = 8 } = {}) {
    const db = getDB();
    let query = db.collection(COL).select(...LIST_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    let docs = snapshot.docs.map(docToObj);
    docs.sort((a, b) => {
      const aTime = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bTime = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });
    return docs.slice(0, parseInt(limit));
  },

  async findById(id) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) return null;
    return docToObj(doc);
  },

  async create(data) {
    const db = getDB();
    const ts = now();
    const payload = {
      fullName:       data.fullName       || '',
      email:          data.email          || '',
      linkedinUrl:    data.linkedinUrl    || '',
      phone:          data.phone          || '',
      location:       data.location       || '',
      currentTitle:   data.currentTitle   || '',
      photoUrl:       data.photoUrl       || '',
      resumeText:      data.resumeText      || '',
      resumeUrl:       data.resumeUrl       || '',
      resumeFileName:  data.resumeFileName  || '',
      linkedinProfile: data.linkedinProfile || null,
      status:         data.status         || 'pending',
      notes:          data.notes          || '',
      role:           data.role           || '',
      recruiterId:    data.recruiterId    || '',
      recruiterName:  data.recruiterName  || '',
      companyId:      data.companyId      || '',
      companyName:    data.companyName    || '',
      ownerId:        data.ownerId        || '',  // hiring manager who created this
      ownerName:      data.ownerName      || '',
      outreachMessages:    Array.isArray(data.outreachMessages)    ? data.outreachMessages    : [],
      interviewScenarios:  Array.isArray(data.interviewScenarios)  ? data.interviewScenarios  : [],
      conversationHistory: Array.isArray(data.conversationHistory) ? data.conversationHistory : [],
      appliedScenario:     data.appliedScenario || '',
      createdAt: data.createdAt || ts,
      updatedAt: data.updatedAt || ts,
    };
    const ref = await db.collection(COL).add(payload);
    return { id: ref.id, ...payload };
  },

  async update(id, data) {
    const db = getDB();
    const updates = { ...data, updatedAt: now() };
    await db.collection(COL).doc(id).update(updates);
    return Candidate.findById(id);
  },

  async delete(id) {
    const db = getDB();
    await db.collection(COL).doc(id).delete();
    return { message: 'Candidate deleted' };
  },

  async pushScenario(id, scenario) {
    const db = getDB();
    const admin = require('firebase-admin');
    await db.collection(COL).doc(id).update({
      interviewScenarios: admin.firestore.FieldValue.arrayUnion({
        content: scenario.content, role: scenario.role, createdAt: now(),
      }),
      updatedAt: now(),
    });
  },

  async pushOutreachMessage(id, msg) {
    const db = getDB();
    const admin = require('firebase-admin');
    const ts = now();
    await db.collection(COL).doc(id).update({
      outreachMessages: admin.firestore.FieldValue.arrayUnion({
        content: msg.content, type: msg.type, createdAt: ts,
      }),
      lastMessageAt: ts,
      updatedAt: ts,
    });
  },

  async pushConversation(id, entries) {
    const db = getDB();
    const ts = now();
    const withTimestamps = entries.map(e => ({ ...e, timestamp: ts, createdAt: ts }));
    const doc = await db.collection(COL).doc(id).get();
    const docData = doc.data();
    const existing = docData.conversationHistory || [];
    const updatedHistory = [...existing, ...withTimestamps];
    const engagement = computeEngagement(updatedHistory);
    const combined = computeCombined(engagement.engagementScore, docData.aiEngagementScore ?? null, engagement.noReplyPenalty);
    await db.collection(COL).doc(id).update({
      conversationHistory:     updatedHistory,
      lastMessageAt:           ts,
      updatedAt:               ts,
      avgResponseMs:           engagement.avgResponseMs,
      candidateMessageCount:   engagement.candidateMessageCount,
      engagementScore:         engagement.engagementScore,
      combinedEngagementScore: combined,
      engagementLabel:         engagementLabelFromScore(combined),
    });

    // Trigger AI deep analysis when new real candidate messages were added
    const hasNewCandidateMsg = entries.some(e => e.role === 'user');
    if (hasNewCandidateMsg && engagement.candidateMessageCount >= 1) {
      analyzeEngagementWithAI(id, updatedHistory, engagement, docData.ownerId).catch(() => {});
    }
  },

  async clearConversation(id) {
    const db = getDB();
    await db.collection(COL).doc(id).update({
      conversationHistory:    [],
      candidateMessageCount:  0,
      engagementScore:        1,
      engagementLabel:        'Unresponsive',
      avgResponseMs:          null,
      aiEngagementScore:      null,
      aiEngagementReasoning:  '',
      combinedEngagementScore: null,
      updatedAt: now(),
    });
  },

  async deleteConversationMessage(id, index) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const data = doc.data();
    const arr = [...(data.conversationHistory || [])];
    arr.splice(index, 1);
    await db.collection(COL).doc(id).update({ conversationHistory: arr, updatedAt: now() });
    await persistEngagement(id, db, arr, data.ownerId);
  },

  async deleteOutreachMessage(id, index) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const arr = [...(doc.data().outreachMessages || [])];
    arr.splice(index, 1);
    await db.collection(COL).doc(id).update({ outreachMessages: arr, updatedAt: now() });
  },

  async deleteScenario(id, index) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const arr = [...(doc.data().interviewScenarios || [])];
    arr.splice(index, 1);
    await db.collection(COL).doc(id).update({ interviewScenarios: arr, updatedAt: now() });
  },

  async updateConversationMessage(id, index, newContent) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const data = doc.data();
    const arr = [...(data.conversationHistory || [])];
    if (index < 0 || index >= arr.length) throw new Error('Message index out of range');
    arr[index] = { ...arr[index], content: newContent, editedAt: now() };
    await db.collection(COL).doc(id).update({ conversationHistory: arr, updatedAt: now() });
    await persistEngagement(id, db, arr, data.ownerId);
  },

  async updateScenario(id, index, newContent) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const arr = [...(doc.data().interviewScenarios || [])];
    if (index < 0 || index >= arr.length) throw new Error('Scenario index out of range');
    arr[index] = { ...arr[index], content: newContent, editedAt: new Date().toISOString() };
    await db.collection(COL).doc(id).update({ interviewScenarios: arr, updatedAt: new Date().toISOString() });
  },

  async updateOutreachMessage(id, index, newContent) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const arr = [...(doc.data().outreachMessages || [])];
    if (index < 0 || index >= arr.length) throw new Error('Message index out of range');
    arr[index] = { ...arr[index], content: newContent, editedAt: new Date().toISOString() };
    await db.collection(COL).doc(id).update({ outreachMessages: arr, updatedAt: new Date().toISOString() });
  },

  // Backfill lastMessageAt for candidates that don't have it yet
  // Reads full docs only for candidates missing the field, then writes it back
  async backfillLastMessageAt() {
    const db = getDB();
    const snapshot = await db.collection(COL).select('lastMessageAt', 'conversationHistory', 'outreachMessages', 'createdAt').get();
    const batch = db.batch();
    let count = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.lastMessageAt) continue; // already set
      const msgs = [
        ...(data.conversationHistory || []),
        ...(data.outreachMessages || []),
      ];
      const timestamps = msgs.map(m => m.createdAt || m.timestamp || '').filter(Boolean).sort();
      const lastTs = timestamps[timestamps.length - 1] || data.createdAt || null;
      if (lastTs) {
        batch.update(doc.ref, { lastMessageAt: lastTs });
        count++;
      }
    }
    if (count > 0) await batch.commit();
    return count;
  },

  // Transfer ownerId for a specific list of candidate IDs to a new owner (admin bulk move)
  async reassignOwnerBulk(candidateIds, toOwnerId, toOwnerName) {
    const db = getDB();
    const batch = db.batch();
    candidateIds.forEach(id => {
      batch.update(db.collection(COL).doc(id), { ownerId: toOwnerId, ownerName: toOwnerName || '', updatedAt: now() });
    });
    if (candidateIds.length > 0) await batch.commit();
    return candidateIds.length;
  },

  // Transfer ownerId for all candidates belonging to a recruiter from one user to another
  async reassignOwner(fromOwnerId, toOwnerId, recruiterId, toOwnerName) {
    const db = getDB();
    const snap = await db.collection(COL).where('ownerId', '==', fromOwnerId).get();
    const batch = db.batch();
    let count = 0;
    snap.docs.forEach(doc => {
      if (doc.data().recruiterId === recruiterId) {
        batch.update(doc.ref, { ownerId: toOwnerId, ownerName: toOwnerName || '', updatedAt: now() });
        count++;
      }
    });
    if (count > 0) await batch.commit();
    return count;
  },

  // Check ownership (non-admin users can only access their own)
  canAccess(candidate, user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    return candidate.ownerId === user.id;
  },
};

module.exports = Candidate;
