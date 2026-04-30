const { getDB } = require('../utils/firebase');

const COL = 'knowledge_base';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

// Firestore hard limit is 1 MiB per document. We store up to 700 KB of content
// per document and split larger texts across multiple linked chunk documents.
const MAX_CONTENT_BYTES = 700_000;

function splitIntoChunks(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_CONTENT_BYTES) return [text];
  const chunks = [];
  // Approximate chars per chunk assuming worst-case 3 bytes/char
  const charsPerChunk = Math.floor(MAX_CONTENT_BYTES / 3);
  for (let i = 0; i < text.length; i += charsPerChunk) {
    const chunk = text.substring(i, i + charsPerChunk);
    // If the byte size still exceeds the limit (heavy Unicode), shrink further
    if (Buffer.byteLength(chunk, 'utf8') > MAX_CONTENT_BYTES) {
      // Binary-search for a safe cut point
      let lo = 0, hi = chunk.length;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        Buffer.byteLength(chunk.substring(0, mid), 'utf8') <= MAX_CONTENT_BYTES ? (lo = mid) : (hi = mid);
      }
      chunks.push(chunk.substring(0, lo));
      // Push remainder back as a separate iteration would miss it — handle inline
      if (lo < chunk.length) chunks.push(chunk.substring(lo));
    } else {
      chunks.push(chunk);
    }
  }
  return chunks;
}

// Merge chunk documents back into their parent, returning only top-level items.
function mergeChunks(allDocs, filterFn) {
  const chunkMap = {};
  const topLevel = [];

  allDocs.forEach(d => {
    if (d.isChunk && d.parentId) {
      if (!chunkMap[d.parentId]) chunkMap[d.parentId] = [];
      chunkMap[d.parentId].push(d);
    } else if (!filterFn || filterFn(d)) {
      topLevel.push(d);
    }
  });

  return topLevel
    .map(p => {
      if (!p.chunkCount || p.chunkCount <= 1) return p;
      const chunks = (chunkMap[p.id] || []).sort((a, b) => a.chunkIndex - b.chunkIndex);
      return { ...p, content: p.content + chunks.map(c => c.content).join('') };
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

const KnowledgeBase = {
  async findByUser(ownerId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return mergeChunks(snap.docs.map(docToObj), d => d.ownerId === ownerId);
  },

  async findAll() {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return mergeChunks(snap.docs.map(docToObj));
  },

  async create(data) {
    const db = getDB();
    const ts = now();
    const content = data.content || '';
    const chunks  = splitIntoChunks(content);

    const basePayload = {
      name:        data.name        || '',
      type:        data.type        || 'custom_instructions',
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

    // Store first chunk in the main document
    const mainPayload = { ...basePayload, content: chunks[0], chunkCount: chunks.length };
    const ref = await db.collection(COL).add(mainPayload);
    const parentId = ref.id;

    // Store remaining chunks as linked sibling documents
    if (chunks.length > 1) {
      const batch = db.batch();
      chunks.slice(1).forEach((chunk, i) => {
        const chunkRef = db.collection(COL).doc();
        batch.set(chunkRef, {
          isChunk:    true,
          parentId,
          chunkIndex: i + 1,
          content:    chunk,
          ownerId:    data.ownerId || '',
          createdAt:  ts,
          updatedAt:  ts,
        });
      });
      await batch.commit();
    }

    // Return with the full reassembled content so the caller has the complete text
    return { id: parentId, ...mainPayload, content };
  },

  // Admin passes null for ownerId to bypass ownership check
  async delete(id, ownerId) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    if (ownerId && doc.data().ownerId !== ownerId) throw new Error('Access denied');

    await db.collection(COL).doc(id).delete();

    // Delete any overflow chunks linked to this parent
    if ((doc.data().chunkCount || 0) > 1) {
      const chunkSnap = await db.collection(COL).where('parentId', '==', id).get();
      if (!chunkSnap.empty) {
        const batch = db.batch();
        chunkSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  },

  // Transfer ownership of all KB items for a specific company from one user to another
  async reassignOwner(fromOwnerId, toOwnerId, companyId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const batch = db.batch();
    let count = 0;
    snap.docs.forEach(doc => {
      const d = doc.data();
      // Update both top-level docs and their chunks (chunks carry ownerId too)
      if (d.ownerId === fromOwnerId && (d.isChunk || d.companyId === companyId)) {
        batch.update(doc.ref, { ownerId: toOwnerId, updatedAt: now() });
        if (!d.isChunk) count++;
      }
    });
    if (count > 0) await batch.commit();
    return count;
  },

  // Reassign all KB items from one company to another for a given user
  async reassignCompany(ownerId, fromCompanyId, toCompanyId, toCompanyName) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const batch = db.batch();
    let count = 0;
    const normalise = (v) => (v == null ? '' : v);
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.isChunk && d.ownerId === ownerId && normalise(d.companyId) === normalise(fromCompanyId)) {
        batch.update(doc.ref, { companyId: toCompanyId, companyName: toCompanyName, updatedAt: now() });
        count++;
      }
    });
    if (count > 0) await batch.commit();
    return count;
  },
};

module.exports = KnowledgeBase;
