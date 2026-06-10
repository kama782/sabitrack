const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB base64 limit

// ── ЗАГРУЗИТЬ ДОКУМЕНТ (только няня) ──
router.post('/', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  const { doc_type, title, file_data, file_name, mime_type } = req.body;

  if (!file_data || !title || !file_name)
    return res.status(400).json({ error: 'Укажите файл и название' });
  if (file_data.length > MAX_SIZE)
    return res.status(400).json({ error: 'Файл слишком большой (макс. 3 МБ)' });

  const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
  if (!allowed.includes(mime_type))
    return res.status(400).json({ error: 'Разрешены: JPG, PNG, WebP, PDF' });

  try {
    const result = await pool.query(
      `INSERT INTO nanny_documents (nanny_id, doc_type, title, file_data, file_name, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, doc_type, title, file_name, mime_type, created_at`,
      [nanny_id, doc_type || 'other', title, file_data, file_name, mime_type]
    );
    console.log(`[DOC] Няня id=${nanny_id} загрузила документ: ${title}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── СВОИ ДОКУМЕНТЫ (няня) ──
router.get('/my', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  try {
    const result = await pool.query(
      `SELECT id, doc_type, title, file_name, mime_type, created_at
       FROM nanny_documents WHERE nanny_id = $1 ORDER BY created_at DESC`,
      [nanny_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── СКАЧАТЬ ДОКУМЕНТ (просмотр файла) — доступно няне, админу и родителям у кого есть заказ ──
router.get('/:id/file', requireAuth, async (req, res) => {
  const { role, user_id } = req.session;
  try {
    const doc = await pool.query(
      `SELECT * FROM nanny_documents WHERE id = $1`, [req.params.id]
    );
    if (doc.rows.length === 0) return res.status(404).json({ error: 'Документ не найден' });
    const d = doc.rows[0];

    // Права доступа
    if (role === 'nanny' && d.nanny_id !== user_id)
      return res.status(403).json({ error: 'Нет доступа' });
    if (role === 'parent') {
      // Родитель может смотреть только если есть принятый заказ с этой няней
      const check = await pool.query(
        `SELECT id FROM orders WHERE parent_id=$1 AND nanny_id=$2 AND status IN ('В процессе','Подтверждён','Завершён')`,
        [user_id, d.nanny_id]
      );
      if (check.rows.length === 0)
        return res.status(403).json({ error: 'Доступ к документам возможен только после принятия заказа' });
    }

    res.json({ file_data: d.file_data, mime_type: d.mime_type, file_name: d.file_name });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ДОКУМЕНТЫ КОНКРЕТНОЙ НЯНИ (для админа и родителя — список без файлов) ──
router.get('/nanny/:nanny_id', requireAuth, async (req, res) => {
  const { role, user_id } = req.session;
  const nanny_id = parseInt(req.params.nanny_id);

  try {
    if (role === 'parent') {
      const check = await pool.query(
        `SELECT id FROM orders WHERE parent_id=$1 AND nanny_id=$2 AND status IN ('В процессе','Подтверждён','Завершён')`,
        [user_id, nanny_id]
      );
      if (check.rows.length === 0)
        return res.status(403).json({ error: 'Доступ к документам возможен только после принятия заказа' });
    } else if (role !== 'admin' && role !== 'nanny') {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const result = await pool.query(
      `SELECT id, doc_type, title, file_name, mime_type, created_at
       FROM nanny_documents WHERE nanny_id = $1 ORDER BY created_at DESC`,
      [nanny_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── УДАЛИТЬ ДОКУМЕНТ (только своя няня) ──
router.delete('/:id', requireAuth, requireRole('nanny'), async (req, res) => {
  const nanny_id = req.session.user_id;
  try {
    await pool.query(
      `DELETE FROM nanny_documents WHERE id=$1 AND nanny_id=$2`, [req.params.id, nanny_id]
    );
    res.json({ message: 'Документ удалён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
