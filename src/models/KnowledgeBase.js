const { getDB } = require('../utils/firebase');

const COL        = 'knowledge_base';
const CHUNKS_COL = 'knowledge_base_chunks'; // separate collection — never appears in main list

const now      = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

// Firestore hard limit is 1 MiB per document. We store up to 600 KB of content
// per document and overflow into the chunks collection for larger texts.
const MAX_CONTENT_BYTES = 600_000;

function splitIntoChunks(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_CONTENT_BYTES) return [text];
  const chunks = [];
  // Use ~180k chars per chunk (worst-case 3 bytes/char ≈ 540KB, safely under 600KB)
  const charsPerChunk = 180_000;
  for (let i = 0; i < text.length; i += charsPerChunk) {
    chunks.push(text.substring(i, i + charsPerChunk));
  }
  return chunks;
}

async function fetchChunksForParent(db, parentId) {
  const snap = await db.collection(CHUNKS_COL).where('parentId', '==', parentId).get();
  return snap.docs
    .map(docToObj)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

async function mergeContent(db, doc) {
  if (!doc.chunkCount || doc.chunkCount <= 1) return doc;
  const chunks = await fetchChunksForParent(db, doc.id);
  return { ...doc, content: doc.content + chunks.map(c => c.content).join('') };
}

const KnowledgeBase = {
  async findByUser(ownerId) {
    const db   = getDB();
    const snap = await db.collection(COL).get();
    const docs = snap.docs
      .map(docToObj)
      .filter(d => d.ownerId === ownerId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Fetch chunks in parallel for any chunked documents
    return Promise.all(docs.map(d => mergeContent(db, d)));
  },

  async findAll() {
    const db   = getDB();
    const snap = await db.collection(COL).get();
    const docs = snap.docs
      .map(docToObj)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return Promise.all(docs.map(d => mergeContent(db, d)));
  },

  async create(data) {
    const db     = getDB();
    const ts     = now();
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
      chunkCount:  chunks.length,
    };

    // First chunk goes in the main document
    const mainPayload = { ...basePayload, content: chunks[0] };
    const ref         = await db.collection(COL).add(mainPayload);
    const parentId    = ref.id;

    // Overflow chunks go into the separate chunks collection
    if (chunks.length > 1) {
      const batch = db.batch();
      chunks.slice(1).forEach((chunk, i) => {
        const chunkRef = db.collection(CHUNKS_COL).doc();
        batch.set(chunkRef, {
          parentId,
          chunkIndex: i + 1,
          content:    chunk,
          ownerId:    data.ownerId || '',
          createdAt:  ts,
        });
      });
      await batch.commit();
    }

    // Return full content so the caller has everything immediately
    return { id: parentId, ...mainPayload, content };
  },

  // Admin passes null for ownerId to bypass ownership check
  async delete(id, ownerId) {
    const db  = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    if (ownerId && doc.data().ownerId !== ownerId) throw new Error('Access denied');

    await db.collection(COL).doc(id).delete();

    // Clean up any overflow chunks
    if ((doc.data().chunkCount || 0) > 1) {
      const chunkSnap = await db.collection(CHUNKS_COL).where('parentId', '==', id).get();
      if (!chunkSnap.empty) {
        const batch = db.batch();
        chunkSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  },

  // Transfer ownership of all KB items for a specific company from one user to another
  async reassignOwner(fromOwnerId, toOwnerId, companyId) {
    const db   = getDB();
    const snap = await db.collection(COL).get();
    const batch = db.batch();
    let count = 0;
    const parentIds = [];
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (d.ownerId === fromOwnerId && d.companyId === companyId) {
        batch.update(doc.ref, { ownerId: toOwnerId, updatedAt: now() });
        count++;
        if ((d.chunkCount || 0) > 1) parentIds.push(doc.id);
      }
    });
    if (count > 0) await batch.commit();

    // Reassign chunks too
    for (const parentId of parentIds) {
      const chunkSnap = await db.collection(CHUNKS_COL).where('parentId', '==', parentId).get();
      if (!chunkSnap.empty) {
        const cb = db.batch();
        chunkSnap.docs.forEach(d => cb.update(d.ref, { ownerId: toOwnerId }));
        await cb.commit();
      }
    }

    return count;
  },

  // Reassign all KB items from one company to another for a given user
  async reassignCompany(ownerId, fromCompanyId, toCompanyId, toCompanyName) {
    const db    = getDB();
    const snap  = await db.collection(COL).get();
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
