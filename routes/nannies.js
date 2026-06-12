const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── СПИСОК НЯНЬ (публичный — только верифицированные) ──
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, experience, status, rating, available, badge_identity, badge_background, badge_professional
       FROM nannies
       WHERE status = 'Верифицирована'
       ORDER BY rating DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ВСЕ ПОЛЬЗОВАТЕЛИ (только админ) — должен быть ДО /:id ──
router.get('/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const parents = await pool.query(`SELECT id, name, email, phone, created_at FROM parents ORDER BY created_at DESC`);
    const nannies = await pool.query(`SELECT id, name, email, phone, status, rating, experience, available, badge_identity, badge_background, badge_professional, created_at FROM nannies ORDER BY created_at DESC`);
    res.json({ parents: parents.rows, nannies: nannies.rows });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ПРОФИЛЬ НЯНИ ──
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, experience, status, rating, available, created_at FROM nannies WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Няня не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ВЕРИФИКАЦИЯ НЯНИ (только админ) ──
router.patch('/:id/verify', requireAuth, requireRole('admin'), async (req, res) => {
  const { status } = req.body;
  const allowed = ['Верифицирована', 'Отказано', 'На проверке'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' });
  try {
    const result = await pool.query(
      `UPDATE nannies SET status = $1 WHERE id = $2 RETURNING id, name, status`,
      [status, req.params.id]
    );
    console.log(`[ADMIN] Няня id=${req.params.id} → статус: ${status}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── БЕЙДЖИ НЯНИ (только админ) ──
router.patch('/:id/badges', requireAuth, requireRole('admin'), async (req, res) => {
  const { badge_identity, badge_background, badge_professional } = req.body;
  try {
    const result = await pool.query(
      `UPDATE nannies SET
        badge_identity     = COALESCE($1, badge_identity),
        badge_background   = COALESCE($2, badge_background),
        badge_professional = COALESCE($3, badge_professional)
       WHERE id = $4
       RETURNING id, name, badge_identity, badge_background, badge_professional`,
      [badge_identity, badge_background, badge_professional, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ПЕРЕКЛЮЧИТЬ ДОСТУПНОСТЬ НЯНИ (только сама няня) ──
router.patch('/me/availability', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  try {
    const result = await pool.query(
      `UPDATE nannies SET available = NOT available WHERE id = $1 RETURNING id, available`,
      [nanny_id]
    );
    const av = result.rows[0].available;
    console.log(`[NANNY] id=${nanny_id} доступность → ${av}`);
    res.json({ available: av });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── РЕДАКТИРОВАТЬ АНКЕТУ НЯНИ (только сама няня) ──
router.patch('/me/profile', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  const { experience, phone, bio, exp_infants, exp_toddlers, exp_preschool, stop_factors, med_book_status, first_aid, hourly_rate } = req.body;
  try {
    const result = await pool.query(
      `UPDATE nannies SET
        experience      = COALESCE($1, experience),
        phone           = COALESCE($2, phone),
        bio             = COALESCE($3, bio),
        exp_infants     = COALESCE($4, exp_infants),
        exp_toddlers    = COALESCE($5, exp_toddlers),
        exp_preschool   = COALESCE($6, exp_preschool),
        stop_factors    = COALESCE($7, stop_factors),
        med_book_status = COALESCE($8, med_book_status),
        first_aid       = COALESCE($9, first_aid),
        hourly_rate     = COALESCE($10, hourly_rate)
       WHERE id = $11
       RETURNING *`,
      [experience, phone, bio, exp_infants, exp_toddlers, exp_preschool, stop_factors, med_book_status, first_aid, hourly_rate, nanny_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ (только админ) ──
router.delete('/admin/users/:role/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { role, id } = req.params;
  const tableMap = { parent: 'parents', nanny: 'nannies' };
  const table = tableMap[role];
  if (!table) return res.status(400).json({ error: 'Неверная роль' });
  try {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    console.log(`[ADMIN] Удалён ${role} id=${id}`);
    res.json({ message: 'Пользователь удалён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ОСТАВИТЬ ОТЗЫВ (только родитель) ──
router.post('/:id/review', requireAuth, requireRole('parent'), async (req, res) => {
  const { order_id, rating, text } = req.body;
  const parent_id = req.session.user_id;
  const nanny_id = parseInt(req.params.id);
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Оценка от 1 до 5' });
  try {
    const order = await pool.query(
      `SELECT * FROM orders WHERE id=$1 AND parent_id=$2 AND nanny_id=$3 AND status='Завершён'`,
      [order_id, parent_id, nanny_id]
    );
    if (order.rows.length === 0)
      return res.status(400).json({ error: 'Можно оставить отзыв только по завершённому заказу' });
    await pool.query(
      `INSERT INTO reviews (order_id, parent_id, nanny_id, rating, text) VALUES ($1,$2,$3,$4,$5)`,
      [order_id, parent_id, nanny_id, rating, text]
    );
    await pool.query(
      `UPDATE nannies SET rating = (
        SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE nanny_id = $1
       ) WHERE id = $1`,
      [nanny_id]
    );
    res.status(201).json({ message: 'Отзыв сохранён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
