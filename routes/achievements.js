const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── ПОЛУЧИТЬ МОИ ДОСТИЖЕНИЯ ──
router.get('/my', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  try {
    const result = await pool.query(
      `SELECT * FROM achievements WHERE user_id = $1 AND role = $2 ORDER BY earned_at DESC`,
      [user_id, role]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ПОЛУЧИТЬ БАЛЛЫ ──
router.get('/points', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  const table = role === 'parent' ? 'parents' : 'nannies';
  try {
    const result = await pool.query(`SELECT points FROM ${table} WHERE id = $1`, [user_id]);
    res.json({ points: result.rows[0]?.points || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ТАБЛИЦА ЛИДЕРОВ НЯНЬ ──
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, points, rating FROM nannies 
       WHERE status = 'Верифицирована' 
       ORDER BY points DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;