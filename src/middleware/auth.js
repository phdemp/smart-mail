const { verifyToken } = require('../auth');

function requireAuth(req, res, next) {
  const h = (req.headers && req.headers.authorization) || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: payload.userId, email: payload.email };
  next();
}

module.exports = { requireAuth };
