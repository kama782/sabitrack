const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── ПОЛУЧИТЬ ИЗБРАННЫХ НЯНЬ ──
router.get('/', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  try {
    const result = await pool.query(
      `SELECT n.id, n.name, n.experience, n.status, n.rating, n.available, n.badge_identity, n.badge_background, n.badge_professional
       FROM favorites f
       JOIN nannies n ON n.id = f.nanny_id
       WHERE f.parent_id = $1
       ORDER BY f.created_at DESC`,
      [parent_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ДОБАВИТЬ В ИЗБРАННОЕ ──
router.post('/:nanny_id', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const nanny_id = req.params.nanny_id;
  try {
    await pool.query(
      `INSERT INTO favorites (parent_id, nanny_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [parent_id, nanny_id]
    );
    res.json({ message: 'Добавлено в избранное' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── УБРАТЬ ИЗ ИЗБРАННОГО ──
router.delete('/:nanny_id', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const nanny_id = req.params.nanny_id;
  try {
    await pool.query(
      `DELETE FROM favorites WHERE parent_id = $1 AND nanny_id = $2`,
      [parent_id, nanny_id]
    );
    res.json({ message: 'Убрано из избранного' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;