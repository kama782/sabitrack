const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// Папка для хранения фото
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `msg_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения'));
    }
  }
});

// ── ОТПРАВИТЬ СООБЩЕНИЕ (текст или фото) ──
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  const { order_id, text } = req.body;
  const { role, user_id } = req.session;
  if (!['parent','nanny'].includes(role))
    return res.status(403).json({ error: 'Только родитель и няня могут писать' });
  if (!text?.trim() && !req.file)
    return res.status(400).json({ error: 'Отправьте текст или фото' });

  try {
    const order = await pool.query(
      `SELECT * FROM orders WHERE id=$1 AND status IN ('В процессе','Подтверждён')`, [order_id]
    );
    if (order.rows.length === 0)
      return res.status(404).json({ error: 'Заказ не найден или не активен' });
    const o = order.rows[0];
    if (role === 'parent' && o.parent_id !== user_id)
      return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    if (role === 'nanny' && o.nanny_id !== user_id)
      return res.status(403).json({ error: 'Нет доступа к этому заказу' });

    const tbl = role === 'parent' ? 'parents' : 'nannies';
    const uRes = await pool.query(`SELECT name FROM ${tbl} WHERE id=$1`, [user_id]);
    const sender_name = uRes.rows[0]?.name || 'Пользователь';

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const msg = await pool.query(
      `INSERT INTO messages (order_id, sender_role, sender_id, sender_name, text, image_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [order_id, role, user_id, sender_name, text?.trim() || null, image_url]
    );
    res.status(201).json(msg.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ПОЛУЧИТЬ СООБЩЕНИЯ ЧАТА ──
router.get('/:order_id', requireAuth, async (req, res) => {
  const { role, user_id } = req.session;
  const order_id = parseInt(req.params.order_id);
  const after = parseInt(req.query.after) || 0;

  if (!['parent','nanny'].includes(role))
    return res.status(403).json({ error: 'Нет доступа' });

  try {
    const order = await pool.query(`SELECT * FROM orders WHERE id=$1`, [order_id]);
    if (order.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
    const o = order.rows[0];
    if (role === 'parent' && o.parent_id !== user_id)
      return res.status(403).json({ error: 'Нет доступа' });
    if (role === 'nanny' && o.nanny_id !== user_id)
      return res.status(403).json({ error: 'Нет доступа' });

    const result = await pool.query(
      `SELECT id, sender_role, sender_id, sender_name, text, image_url, created_at
       FROM messages WHERE order_id=$1 AND id > $2
       ORDER BY created_at ASC LIMIT 100`,
      [order_id, after]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;