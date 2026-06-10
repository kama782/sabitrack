const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── ПОЛУЧИТЬ ДЕТЕЙ ТЕКУЩЕГО РОДИТЕЛЯ ──
router.get('/my', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  try {
    const result = await pool.query(
      `SELECT * FROM children WHERE parent_id = $1 ORDER BY id`, [parent_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ДОБАВИТЬ РЕБЁНКА ──
router.post('/', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const { name, age, features } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите имя ребёнка' });
  if (!age || isNaN(age) || age < 0 || age > 17)
    return res.status(400).json({ error: 'Укажите возраст от 0 до 17 лет' });
  try {
    const result = await pool.query(
      `INSERT INTO children (parent_id, name, age, features) VALUES ($1,$2,$3,$4) RETURNING *`,
      [parent_id, name, age, features || null]
    );
    console.log(`[CHILD] Добавлен ребёнок для parent_id=${parent_id}: ${name}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── РЕДАКТИРОВАТЬ РЕБЁНКА ──
router.patch('/:id', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const { name, age, features } = req.body;
  try {
    const result = await pool.query(
      `UPDATE children SET
        name     = COALESCE($1, name),
        age      = COALESCE($2, age),
        features = COALESCE($3, features)
       WHERE id = $4 AND parent_id = $5
       RETURNING *`,
      [name, age, features, req.params.id, parent_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Ребёнок не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
