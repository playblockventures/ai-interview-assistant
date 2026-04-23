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
];

const Candidate = {
  // Fetch list using field projection — avoids downloading huge resumeText/conversationHistory
  async findAll({ status, search, page = 1, limit = 20, recruiterId, ownerId, isAdmin, ids, fromDate, toDate } = {}) {
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
    if (recruiterId) docs = docs.filter(d => d.recruiterId === recruiterId);
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
    const FAILED_STATUSES = ['failed', 'no_response', 'not_interested', 'other_job', 'have_a_doubt'];

    let query = db.collection(COL).select(...ANALYTICS_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    const allDocs = snapshot.docs.map(docToObj);

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

    // ── Duplicate groups (unfiltered — operational alert) ──────────────────
    const nameMap = {}, emailMap = {};
    allDocs.forEach(c => {
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
    const statusCounts = { pending: 0, in_progress: 0, success: 0, failed: 0, no_response: 0, not_interested: 0, other_job: 0, have_a_doubt: 0 };
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

  // Active candidates with avg response time computed from conversationHistory timestamps
  async findActiveWithResponseTime({ ownerId, isAdmin, limit = 20 } = {}) {
    const db = getDB();
    // Need full docs to access conversationHistory
    let query = db.collection(COL).where('status', '==', 'in_progress');
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    const docs = snapshot.docs.map(docToObj);

    const withAvg = docs.map(c => {
      const history = (c.conversationHistory || []);

      // Only measure assistant→candidate reply gaps (skip recruiter follow-up prompts)
      const gaps = [];
      let lastAssistantMs = null;
      for (const m of history) {
        const ms = new Date(m.timestamp || m.createdAt || 0).getTime();
        if (!ms) continue;
        if (m.role === 'assistant') {
          lastAssistantMs = ms;
        } else if (m.role === 'user' && m.fromCandidate !== false && lastAssistantMs !== null) {
          // fromCandidate is true (manual insert) or undefined (legacy message) → count it
          gaps.push(ms - lastAssistantMs);
          lastAssistantMs = null; // reset: don't double-count on consecutive user messages
        }
      }

      const avgMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
      const messageCount = history.length;

      // Duration since last outbound message (or candidate creation if no messages)
      const lastContactAt = c.lastMessageAt || c.updatedAt || c.createdAt;
      const durationSinceLastMessageMs = Date.now() - new Date(lastContactAt || 0).getTime();

      // Strip large fields before returning to client
      const { conversationHistory, resumeText, interviewScenarios, ...rest } = c;
      return { ...rest, avgResponseMs: avgMs, messageCount, durationSinceLastMessageMs };
    });

    // Only include candidates with recent activity (last contact within 14 days)
    const ACTIVE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;
    return withAvg
      .filter(c => c.messageCount > 0 && c.durationSinceLastMessageMs <= ACTIVE_THRESHOLD_MS)
      .sort((a, b) => a.durationSinceLastMessageMs - b.durationSinceLastMessageMs)
      .slice(0, parseInt(limit));
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
    const existing = doc.data().conversationHistory || [];
    await db.collection(COL).doc(id).update({
      conversationHistory: [...existing, ...withTimestamps],
      lastMessageAt: ts,
      updatedAt: ts,
    });
  },

  async clearConversation(id) {
    const db = getDB();
    await db.collection(COL).doc(id).update({ conversationHistory: [], updatedAt: now() });
  },

  async deleteConversationMessage(id, index) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    const arr = [...(doc.data().conversationHistory || [])];
    arr.splice(index, 1);
    await db.collection(COL).doc(id).update({ conversationHistory: arr, updatedAt: now() });
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
    const arr = [...(doc.data().conversationHistory || [])];
    if (index < 0 || index >= arr.length) throw new Error('Message index out of range');
    arr[index] = { ...arr[index], content: newContent, editedAt: new Date().toISOString() };
    await db.collection(COL).doc(id).update({ conversationHistory: arr, updatedAt: new Date().toISOString() });
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
