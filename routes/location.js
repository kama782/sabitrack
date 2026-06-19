const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── НЯНЯ ОБНОВЛЯЕТ СВОЁ МЕСТОПОЛОЖЕНИЕ ──
router.post('/update', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  const { latitude, longitude, status, order_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO nanny_location (nanny_id, order_id, latitude, longitude, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (nanny_id) DO UPDATE SET
         order_id = $2, latitude = $3, longitude = $4, status = $5, updated_at = NOW()`,
      [nanny_id, order_id || null, latitude, longitude, status || 'На месте']
    );
    res.json({ message: 'Местоположение обновлено' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── РОДИТЕЛЬ ПОЛУЧАЕТ МЕСТОПОЛОЖЕНИЕ НЯНИ ──
router.get('/nanny/:nanny_id', requireAuth, requireRole('parent'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT nl.*, n.name as nanny_name
       FROM nanny_location nl
       JOIN nannies n ON n.id = nl.nanny_id
       WHERE nl.nanny_id = $1
       AND nl.updated_at > NOW() - INTERVAL '10 minutes'`,
      [req.params.nanny_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Местоположение недоступно' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ИСТОРИЯ МАРШРУТА ──
router.get('/history/:order_id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT latitude, longitude, status, updated_at
       FROM nanny_location_history
       WHERE order_id = $1
       ORDER BY updated_at ASC`,
      [req.params.order_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;