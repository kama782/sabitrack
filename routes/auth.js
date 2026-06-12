const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// ── Вспомогательная функция: создать сессию ──
async function createSession(userId, role) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней
  await pool.query(
    `INSERT INTO sessions (user_id, role, token, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, role, token, expiresAt]
  );
  return token;
}

// ── РЕГИСТРАЦИЯ РОДИТЕЛЯ ──
router.post('/register/parent', async (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const exists = await pool.query('SELECT id FROM parents WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO parents (name, phone, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
      [name, phone, email, hash]
    );
    const user = result.rows[0];
    const token = await createSession(user.id, 'parent');

    console.log(`[AUTH] Новый родитель: ${email} (id: ${user.id})`);
    res.status(201).json({ token, role: 'parent', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── РЕГИСТРАЦИЯ НЯНИ ──
router.post('/register/nanny', async (req, res) => {
  const { name, phone, email, password, experience } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const exists = await pool.query('SELECT id FROM nannies WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO nannies (name, phone, email, password_hash, experience) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, status`,
      [name, phone, email, hash, experience || 0]
    );
    const user = result.rows[0];
    const token = await createSession(user.id, 'nanny');

    console.log(`[AUTH] Новая няня: ${email} (id: ${user.id})`);
    res.status(201).json({ token, role: 'nanny', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ВХОД (универсальный для всех ролей) ──
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role)
    return res.status(400).json({ error: 'Укажите email, пароль и роль' });

  const tableMap = { parent: 'parents', nanny: 'nannies', admin: 'admins' };
  const table = tableMap[role];
  if (!table) return res.status(400).json({ error: 'Неверная роль' });

  try {
    const result = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Неверный email или пароль' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = await createSession(user.id, role);

    // Убираем пароль из ответа
    delete user.password_hash;

    console.log(`[AUTH] Вход: ${email} (роль: ${role}, id: ${user.id})`);
    res.json({ token, role, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ВЫХОД ──
router.post('/logout', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }
  res.json({ message: 'Выход выполнен' });
});

// ── ПРОВЕРКА ТОКЕНА ──
router.get('/me', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });

  try {
    const sess = await pool.query(
      `SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()`, [token]
    );
    if (sess.rows.length === 0)
      return res.status(401).json({ error: 'Сессия не найдена' });

    const { user_id, role } = sess.rows[0];
    const tableMap = { parent: 'parents', nanny: 'nannies', admin: 'admins' };
    const userRes = await pool.query(
      `SELECT * FROM ${tableMap[role]} WHERE id = $1`, [user_id]
    );
    res.json({ role, user: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
