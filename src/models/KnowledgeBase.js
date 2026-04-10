const { getDB } = require('../utils/firebase');

const COL = 'knowledge_base';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

const KnowledgeBase = {
  // Get all items for a specific user — client-side filter, no index needed
  async findByUser(ownerId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs
      .map(docToObj)
      .filter(d => d.ownerId === ownerId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  // Get all items across all users (admin only)
  async findAll() {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs
      .map(docToObj)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async create(data) {
    const db = getDB();
    const ts = now();
    const payload = {
      name:        data.name        || '',
      type:        data.type        || 'custom_instructions',
      content:     data.content     || '',
      url:         data.url         || '',
      fileName:    data.fileName    || '',
      category:    data.category    || 'company_docs',
      companyId:   data.companyId   || '',
      companyName: data.companyName || '',
      ownerId:     data.ownerId     || '',
      ownerName:   data.ownerName   || '',
      createdAt:   ts,
      updatedAt:   ts,
    };
    const ref = await db.collection(COL).add(payload);
    return { id: ref.id, ...payload };
  },

  // Admin passes null for ownerId to bypass ownership check
  async delete(id, ownerId) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    if (ownerId && doc.data().ownerId !== ownerId) throw new Error('Access denied');
    await db.collection(COL).doc(id).delete();
  },
};

module.exports = KnowledgeBase;
