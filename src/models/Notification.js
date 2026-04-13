const { getDB } = require('../utils/firebase');

const COL = 'notifications';
const now = () => new Date().toISOString();
const docToObj = (doc) => ({ id: doc.id, ...doc.data() });

const Notification = {
  async create({ userId, type, title, message, candidateId = '', candidateName = '', createdBy = '', createdByName = '' }) {
    const db = getDB();
    const payload = {
      userId, type, title, message,
      candidateId, candidateName,
      createdBy, createdByName,
      read: false,
      createdAt: now(),
    };
    const ref = await db.collection(COL).add(payload);
    return { id: ref.id, ...payload };
  },

  // Get notifications for a user, newest first, capped at 100
  async findByUser(userId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs
      .map(docToObj)
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  },

  // Admin: get all notifications
  async findAll() {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs
      .map(docToObj)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500);
  },

  async markRead(id) {
    const db = getDB();
    await db.collection(COL).doc(id).update({ read: true });
  },

  async markAllRead(userId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    const unread = snap.docs.filter(d => d.data().userId === userId && !d.data().read);
    await Promise.all(unread.map(d => d.ref.update({ read: true })));
  },

  async delete(id, userId) {
    const db = getDB();
    const doc = await db.collection(COL).doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    // Only owner or admin can delete — caller enforces admin check
    if (userId && doc.data().userId !== userId) throw new Error('Access denied');
    await db.collection(COL).doc(id).delete();
  },

  async unreadCount(userId) {
    const db = getDB();
    const snap = await db.collection(COL).get();
    return snap.docs.filter(d => d.data().userId === userId && !d.data().read).length;
  },
};

module.exports = Notification;
