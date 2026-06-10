const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── МОЙ БАЛАНС ──
router.get('/balance', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  try {
    let balance = 0;
    if (role === 'parent') {
      const r = await pool.query(`SELECT balance FROM parents WHERE id=$1`, [user_id]);
      balance = parseFloat(r.rows[0]?.balance || 0);
    } else if (role === 'nanny') {
      const r = await pool.query(`SELECT balance FROM nannies WHERE id=$1`, [user_id]);
      balance = parseFloat(r.rows[0]?.balance || 0);
    } else if (role === 'admin') {
      const r = await pool.query(`SELECT balance FROM platform_wallet LIMIT 1`);
      balance = parseFloat(r.rows[0]?.balance || 0);
    }
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ПОПОЛНИТЬ БАЛАНС (родитель или няня) ──
router.post('/topup', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  if (!['parent', 'nanny'].includes(role))
    return res.status(403).json({ error: 'Нет доступа' });

  const amount = parseFloat(req.body.amount);
  const method = req.body.method || 'card';
  if (!amount || amount <= 0 || amount > 1000000)
    return res.status(400).json({ error: 'Некорректная сумма' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const table = role === 'parent' ? 'parents' : 'nannies';
    const updated = await client.query(
      `UPDATE ${table} SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
      [amount, user_id]
    );
    await client.query(
      `INSERT INTO topups (user_id, user_role, amount, method) VALUES ($1,$2,$3,$4)`,
      [user_id, role, amount, method]
    );
    await client.query('COMMIT');
    console.log(`[WALLET] Пополнение: ${role} id=${user_id} +${amount} ₸ (${method})`);
    res.json({ balance: parseFloat(updated.rows[0].balance) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally { client.release(); }
});

// ── ОПЛАТА ЗАКАЗА С БАЛАНСА (родитель → няне, минус 10% платформе) ──
router.post('/pay-order', requireAuth, requireRole('parent'), async (req, res) => {
  const parent_id = req.session.user_id;
  const { order_id } = req.body;

  if (!order_id) return res.status(400).json({ error: 'Укажите заказ' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Проверяем заказ
    const orderRes = await client.query(
      `SELECT o.*, n.id as nid FROM orders o
       LEFT JOIN nannies n ON o.nanny_id = n.id
       WHERE o.id=$1 AND o.parent_id=$2`,
      [order_id, parent_id]
    );
    if (orderRes.rows.length === 0) throw new Error('Заказ не найден');
    const order = orderRes.rows[0];
    if (order.payment_status === 'paid') throw new Error('Заказ уже оплачен');

    const total    = parseFloat(order.amount) || 5000;
    const fee      = parseFloat((total * 0.10).toFixed(2));  // 10% платформе
    const nannyAmt = parseFloat((total - fee).toFixed(2));   // 90% няне

    // 2. Проверяем баланс родителя
    const parentRes = await client.query(`SELECT balance FROM parents WHERE id=$1 FOR UPDATE`, [parent_id]);
    const parentBal = parseFloat(parentRes.rows[0].balance);
    if (parentBal < total) throw new Error(`Недостаточно средств. Баланс: ${fmt(parentBal)} ₸, нужно: ${fmt(total)} ₸`);

    // 3. Списываем с родителя
    await client.query(`UPDATE parents SET balance = balance - $1 WHERE id=$2`, [total, parent_id]);

    // 4. Начисляем няне (90%)
    await client.query(`UPDATE nannies SET balance = balance + $1 WHERE id=$2`, [nannyAmt, order.nanny_id]);

    // 5. Комиссию — в кассу платформы (10%)
    await client.query(`UPDATE platform_wallet SET balance = balance + $1, updated_at=NOW()`, [fee]);

    // 6. Записываем транзакцию
    await client.query(
      `INSERT INTO transactions (order_id, parent_id, nanny_id, type, total_amount, platform_fee, nanny_amount, description, status)
       VALUES ($1,$2,$3,'payment',$4,$5,$6,$7,'completed')`,
      [order_id, parent_id, order.nanny_id, total, fee, nannyAmt,
       `Оплата заказа #${order_id}: ${fmt(nannyAmt)} ₸ → няня, ${fmt(fee)} ₸ → платформа`]
    );

    // 7. Обновляем статус заказа
    await client.query(
      `UPDATE orders SET payment_status='paid', status='Подтверждён' WHERE id=$1`, [order_id]
    );

    await client.query('COMMIT');

    const newBal = await pool.query(`SELECT balance FROM parents WHERE id=$1`, [parent_id]);
    console.log(`[WALLET] Оплата заказа #${order_id}: ${total} ₸ (комиссия ${fee} ₸)`);
    res.json({
      success: true,
      total, fee, nanny_amount: nannyAmt,
      new_balance: parseFloat(newBal.rows[0].balance)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── ИСТОРИЯ ТРАНЗАКЦИЙ ──
router.get('/history', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  try {
    let rows;
    if (role === 'parent') {
      const r = await pool.query(
        `SELECT t.*, n.name as nanny_name FROM transactions t
         LEFT JOIN nannies n ON t.nanny_id=n.id
         WHERE t.parent_id=$1 ORDER BY t.created_at DESC LIMIT 50`, [user_id]
      );
      rows = r.rows;
    } else if (role === 'nanny') {
      const r = await pool.query(
        `SELECT t.*, p.name as parent_name FROM transactions t
         LEFT JOIN parents p ON t.parent_id=p.id
         WHERE t.nanny_id=$1 ORDER BY t.created_at DESC LIMIT 50`, [user_id]
      );
      rows = r.rows;
    } else if (role === 'admin') {
      const r = await pool.query(
        `SELECT t.*, p.name as parent_name, n.name as nanny_name FROM transactions t
         LEFT JOIN parents p ON t.parent_id=p.id
         LEFT JOIN nannies n ON t.nanny_id=n.id
         ORDER BY t.created_at DESC LIMIT 100`
      );
      rows = r.rows;
    } else {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // История пополнений тоже
    let topups = [];
    if (role !== 'admin') {
      const tr = await pool.query(
        `SELECT id, amount, method, created_at, 'topup' as type FROM topups
         WHERE user_id=$1 AND user_role=$2 ORDER BY created_at DESC LIMIT 30`,
        [user_id, role]
      );
      topups = tr.rows;
    }

    res.json({ transactions: rows, topups });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── СТАТИСТИКА ПЛАТФОРМЫ (только админ) ──
router.get('/admin/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const wallet   = await pool.query(`SELECT balance FROM platform_wallet LIMIT 1`);
    const totalFee = await pool.query(`SELECT COALESCE(SUM(platform_fee),0) as total FROM transactions WHERE type='payment'`);
    const totalPay = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM transactions WHERE type='payment'`);
    const count    = await pool.query(`SELECT COUNT(*) as cnt FROM transactions WHERE type='payment'`);
    res.json({
      platform_balance: parseFloat(wallet.rows[0]?.balance || 0),
      total_fees_earned: parseFloat(totalFee.rows[0].total),
      total_payments: parseFloat(totalPay.rows[0].total),
      payments_count: parseInt(count.rows[0].cnt),
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

function fmt(n) { return Number(n).toLocaleString('ru'); }

module.exports = router;
