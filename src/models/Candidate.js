const { getDB } = require('../utils/firebase');

const COL = 'candidates';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

const Candidate = {
  // Fetch all, filter client-side (avoids Firestore composite index requirement)
  async findAll({ status, search, page = 1, limit = 20, recruiterId, ownerId, isAdmin } = {}) {
    const db = getDB();
    const snapshot = await db.collection(COL).get();
    let docs = snapshot.docs.map(docToObj);

    if (isAdmin) {
      // Admin can optionally filter by a specific owner; null/undefined = see all
      if (ownerId) docs = docs.filter(d => d.ownerId === ownerId);
    } else {
      // Non-admin: always scoped to their own candidates
      if (ownerId) docs = docs.filter(d => d.ownerId === ownerId);
    }

    // Compute lastMessageAt = latest timestamp across conversation + outreach messages
    docs = docs.map(d => {
      const times = [
        ...(d.conversationHistory || []).map(m => m.timestamp || m.editedAt || ''),
        ...(d.outreachMessages    || []).map(m => m.createdAt  || m.editedAt || ''),
      ].filter(Boolean);
      const lastMessageAt = times.length ? times.reduce((a, b) => a > b ? a : b) : '';
      return { ...d, lastMessageAt };
    });

    docs.sort((a, b) => {
      const aTime = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bTime = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });

    if (status)      docs = docs.filter(d => d.status === status);
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
    const light = paginated.map(({ resumeText, conversationHistory, outreachMessages, interviewScenarios, ...rest }) => rest);
    return { candidates: light, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) };
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
      resumeText:     data.resumeText     || '',
      resumeUrl:      data.resumeUrl      || '',
      resumeFileName: data.resumeFileName || '',
      status:         data.status         || 'pending',
      notes:          data.notes          || '',
      role:           data.role           || '',
      recruiterId:    data.recruiterId    || '',
      recruiterName:  data.recruiterName  || '',
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
    await db.collection(COL).doc(id).update({
      outreachMessages: admin.firestore.FieldValue.arrayUnion({
        content: msg.content, type: msg.type, createdAt: now(),
      }),
      updatedAt: now(),
    });
  },

  async pushConversation(id, entries) {
    const db = getDB();
    const withTimestamps = entries.map(e => ({ ...e, timestamp: now() }));
    const doc = await db.collection(COL).doc(id).get();
    const existing = doc.data().conversationHistory || [];
    await db.collection(COL).doc(id).update({
      conversationHistory: [...existing, ...withTimestamps],
      updatedAt: now(),
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

  // Check ownership (non-admin users can only access their own)
  canAccess(candidate, user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    return candidate.ownerId === user.id;
  },
};

module.exports = Candidate;
