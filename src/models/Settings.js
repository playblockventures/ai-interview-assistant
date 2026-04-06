const { getDB } = require('../utils/firebase');

const COL = 'settings';

// Key helpers — user-scoped vs global
const userKey  = (userId, key) => `${key}_${userId}`;   // e.g. openai_key_abc123
const globalKey = (key) => key;

const Settings = {
  // Get a global setting
  async get(key) {
    const db = getDB();
    const doc = await db.collection(COL).doc(globalKey(key)).get();
    return doc.exists ? doc.data().value : null;
  },

  // Get a user-scoped setting
  async getForUser(userId, key) {
    const db = getDB();
    const doc = await db.collection(COL).doc(userKey(userId, key)).get();
    return doc.exists ? doc.data().value : null;
  },

  // Set a global setting
  async set(key, value) {
    const db = getDB();
    await db.collection(COL).doc(globalKey(key)).set({ value, updatedAt: new Date().toISOString() });
  },

  // Set a user-scoped setting
  async setForUser(userId, key, value) {
    const db = getDB();
    await db.collection(COL).doc(userKey(userId, key)).set({ value, updatedAt: new Date().toISOString() });
  },

  // Get all settings (for admin/settings page)
  async getAll() {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const result = {};
    snap.docs.forEach(d => { result[d.id] = d.data().value; });
    return result;
  },
};

module.exports = Settings;
