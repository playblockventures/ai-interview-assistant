const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'interview-ai-secret-change-in-production';
const EXPIRES = '7d';

const signToken = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES });

const verifyToken = (token) => {
  try { return jwt.verify(token, SECRET); }
  catch (e) { return null; }
};

// Middleware — require valid JWT
const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload; // { id, username, displayName, isAdmin }
  next();
};

// Middleware — require admin
const requireAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

module.exports = { signToken, verifyToken, requireAuth, requireAdmin };
