const pool = require('../db');

async function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Не авторизован' });

  try {
    const result = await pool.query(
      `SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Сессия истекла, войдите снова' });
    }
    req.session = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session?.role)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
