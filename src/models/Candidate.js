const { getDB } = require('../utils/firebase');

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
  async findAll({ status, search, page = 1, limit = 20, recruiterId, ownerId, isAdmin } = {}) {
    const db = getDB();

    // Use .select() so Firestore only returns the fields we need for the list view
    let query = db.collection(COL).select(...LIST_FIELDS);

    // Push ownership and status filters to Firestore
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    if (status)  query = query.where('status',  '==', status);

    const snapshot = await query.get();
    let docs = snapshot.docs.map(docToObj);

    docs.sort((a, b) => {
      const aTime = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bTime = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });

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
    const STAT_FIELDS = ['fullName', 'email', 'status', 'role', 'location',
                         'recruiterId', 'recruiterName', 'ownerId', 'ownerName',
                         'companyId', 'companyName', 'createdAt', 'updatedAt', 'lastMessageAt'];
    let query = db.collection(COL).select(...STAT_FIELDS);
    if (ownerId) query = query.where('ownerId', '==', ownerId);
    const snapshot = await query.get();
    return snapshot.docs.map(docToObj);
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
      resumeText:     data.resumeText     || '',
      resumeUrl:      data.resumeUrl      || '',
      resumeFileName: data.resumeFileName || '',
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
    const withTimestamps = entries.map(e => ({ ...e, timestamp: ts }));
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

  // Check ownership (non-admin users can only access their own)
  canAccess(candidate, user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    return candidate.ownerId === user.id;
  },
};

module.exports = Candidate;
