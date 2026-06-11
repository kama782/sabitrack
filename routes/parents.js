const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/me', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, house_rules, emergency_contact, emergency_phone FROM parents WHERE id = $1`,
      [parent_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.patch('/me', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const { phone, house_rules, emergency_contact, emergency_phone } = req.body;
  try {
    const result = await pool.query(
      `UPDATE parents SET
        phone             = COALESCE($1, phone),
        house_rules       = COALESCE($2, house_rules),
        emergency_contact = COALESCE($3, emergency_contact),
        emergency_phone   = COALESCE($4, emergency_phone)
       WHERE id = $5
       RETURNING id, name, email, phone, house_rules, emergency_contact, emergency_phone`,
      [phone, house_rules, emergency_contact, emergency_phone, parent_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;