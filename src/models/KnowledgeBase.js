const { getDB } = require('../utils/firebase');

const COL = 'knowledge_base';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

const KnowledgeBase = {
  async findByUser(ownerId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs
      .map(docToObj)
      .filter(d => d.ownerId === ownerId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

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

    // Firestore hard limit is 1 MiB per document. Cap content to 800 KB in bytes,
    // leaving ~200 KB for other fields. This covers ~200 pages of typical text.
    let content = data.content || '';
    const MAX_BYTES = 800_000;
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
      // Trim to byte boundary without splitting a multi-byte character
      let byteCount = 0;
      let i = 0;
      while (i < content.length) {
        const charBytes = Buffer.byteLength(content[i], 'utf8');
        if (byteCount + charBytes > MAX_BYTES) break;
        byteCount += charBytes;
        i++;
      }
      content = content.substring(0, i);
    }

    const payload = {
      name:        data.name        || '',
      type:        data.type        || 'custom_instructions',
      content,
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

  async delete(id, ownerId) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    if (ownerId && doc.data().ownerId !== ownerId) throw new Error('Access denied');
    await db.collection(COL).doc(id).delete();
  },

  async reassignOwner(fromOwnerId, toOwnerId, companyId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const batch = db.batch();
    let count = 0;
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (d.ownerId === fromOwnerId && d.companyId === companyId) {
        batch.update(doc.ref, { ownerId: toOwnerId, updatedAt: now() });
        count++;
      }
    });
    if (count > 0) await batch.commit();
    return count;
  },

  async reassignCompany(ownerId, fromCompanyId, toCompanyId, toCompanyName) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const batch = db.batch();
    let count = 0;
    const normalise = (v) => (v == null ? '' : v);
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (d.ownerId === ownerId && normalise(d.companyId) === normalise(fromCompanyId)) {
        batch.update(doc.ref, { companyId: toCompanyId, companyName: toCompanyName, updatedAt: now() });
        count++;
      }
    });
    if (count > 0) await batch.commit();
    return count;
  },
};

module.exports = KnowledgeBase;
