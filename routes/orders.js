const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkAndAwardBadges } = require('../achievements-helper');

// ── СОЗДАТЬ ЗАКАЗ (только родитель) ──
router.post('/', requireAuth, requireRole('parent'), async (req, res) => {
  const { nanny_id, child_id, order_type, date_start, date_end, amount } = req.body;
  const parent_id = req.session.user_id;

  if (!nanny_id || !date_start)
    return res.status(400).json({ error: 'Укажите няню и время' });

  try {
    let resolvedChildId = child_id;
    if (!resolvedChildId) {
      const ch = await pool.query(
        `SELECT id FROM children WHERE parent_id = $1 ORDER BY id LIMIT 1`, [parent_id]
      );
      if (ch.rows.length === 0)
        return res.status(400).json({ error: 'Сначала добавьте данные ребёнка в профиле' });
      resolvedChildId = ch.rows[0].id;
    }

    const nanny = await pool.query(
      `SELECT id, status, available FROM nannies WHERE id = $1`, [nanny_id]
    );
    if (nanny.rows.length === 0)
      return res.status(404).json({ error: 'Няня не найдена' });
    if (nanny.rows[0].status !== 'Верифицирована')
      return res.status(400).json({ error: 'Няня ещё не верифицирована' });
    if (!nanny.rows[0].available)
      return res.status(400).json({ error: 'Няня сейчас занята' });

    const resolvedDateEnd = date_end || null;

    const conflictCheck = await pool.query(
      `SELECT id, date_start, date_end FROM orders
       WHERE nanny_id = $1
         AND status NOT IN ('Отклонён', 'Отклонено', 'Завершён')
         AND date_start IS NOT NULL
         AND (
           ($3::timestamptz IS NOT NULL AND
             (date_start - interval '30 minutes') < $3::timestamptz
             AND (COALESCE(date_end, date_start + interval '2 hours') + interval '30 minutes') > $2::timestamptz
           )
           OR
           ($3::timestamptz IS NULL AND
             ABS(EXTRACT(EPOCH FROM (date_start - $2::timestamptz))) < 5400
           )
         )`,
      [nanny_id, date_start, resolvedDateEnd]
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'Это время уже занято. Выберите другое время (между заказами должно быть не менее 30 минут).'
      });
    }

    const result = await pool.query(
      `INSERT INTO orders (parent_id, nanny_id, child_id, order_type, date_start, date_end, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [parent_id, nanny_id, resolvedChildId, order_type || 'Плановый', date_start, date_end, amount || 5000]
    );
    console.log(`[ORDER] Новый заказ #${result.rows[0].id} от parent_id=${parent_id}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── МОИ ЗАКАЗЫ ──
router.get('/my', requireAuth, async (req, res) => {
  const { user_id, role } = req.session;
  try {
    let result;
    if (role === 'parent') {
      result = await pool.query(
        `SELECT o.*, n.name as nanny_name, c.name as child_name, o.payment_status
         FROM orders o
         LEFT JOIN nannies n ON o.nanny_id = n.id
         LEFT JOIN children c ON o.child_id = c.id
         WHERE o.parent_id = $1 ORDER BY o.created_at DESC`,
        [user_id]
      );
    } else if (role === 'nanny') {
      result = await pool.query(
        `SELECT o.*, p.name as parent_name, c.name as child_name, c.age, c.features
         FROM orders o
         LEFT JOIN parents p ON o.parent_id = p.id
         LEFT JOIN children c ON o.child_id = c.id
         WHERE o.nanny_id = $1 ORDER BY o.created_at DESC`,
        [user_id]
      );
    } else {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ВСЕ ЗАКАЗЫ (только админ) ──
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, p.name as parent_name, n.name as nanny_name, c.name as child_name
       FROM orders o
       LEFT JOIN parents p ON o.parent_id = p.id
       LEFT JOIN nannies n ON o.nanny_id = n.id
       LEFT JOIN children c ON o.child_id = c.id
       ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── СТАТИСТИКА ДЛЯ АДМИНА (должен быть ДО /:id) ──
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const totalOrders = await pool.query(`SELECT COUNT(*) as total FROM orders`);
    const paidOrders = await pool.query(`SELECT COUNT(*) as total FROM orders WHERE payment_status = 'paid'`);
    const totalRevenue = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM transactions`);
    const totalFees = await pool.query(`SELECT COALESCE(SUM(platform_fee),0) as total FROM transactions`);
    const topNannies = await pool.query(
      `SELECT n.name, n.rating, COUNT(o.id) as orders_count
       FROM nannies n
       LEFT JOIN orders o ON o.nanny_id = n.id AND o.status = 'Завершён'
       WHERE n.status = 'Верифицирована'
       GROUP BY n.id, n.name, n.rating
       ORDER BY orders_count DESC, n.rating DESC NULLS LAST
       LIMIT 5`
    );
    const ordersByDay = await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) as count
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    );
    res.json({
      total_orders: parseInt(totalOrders.rows[0].total),
      paid_orders: parseInt(paidOrders.rows[0].total),
      total_revenue: parseFloat(totalRevenue.rows[0].total),
      total_fees: parseFloat(totalFees.rows[0].total),
      top_nannies: topNannies.rows,
      orders_by_day: ordersByDay.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ИЗМЕНИТЬ СТАТУС ЗАКАЗА ──
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const acceptedOrder = result.rows[0];

    if (status === 'В процессе') {
      const { nanny_id, date_start, date_end } = acceptedOrder;
      const rejectSql = `
        UPDATE orders 
        SET status = 'Отклонено' 
        WHERE status = 'Ожидает' 
          AND nanny_id = $1 
          AND id != $2
          AND (
            (date_start - interval '30 minutes') < $3 
            AND 
            (date_end + interval '30 minutes') > $4
          )
      `;
      await pool.query(rejectSql, [nanny_id, id, date_end, date_start]);
    }

    if (status === 'Завершён') {
      checkAndAwardBadges(acceptedOrder.nanny_id, 'nanny');
      checkAndAwardBadges(acceptedOrder.parent_id, 'parent');
    }

    res.json(acceptedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── ОПЛАТА С КОМИССИЕЙ 10% ──
router.post('/create-payment', requireAuth, requireRole('parent'), async (req, res) => {
  const { order_id, total_amount } = req.body;
  const parent_id = req.session.user_id;

  try {
    const orderCheck = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND parent_id = $2`,
      [order_id, parent_id]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const amount = parseFloat(total_amount);
    const platform_fee = amount * 0.10;
    const nanny_amount = amount - platform_fee;

    const transaction = await pool.query(
      `INSERT INTO transactions (order_id, parent_id, nanny_id, total_amount, platform_fee, nanny_amount, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'completed') RETURNING *`,
      [order_id, parent_id, orderCheck.rows[0].nanny_id, amount, platform_fee, nanny_amount]
    );

    await pool.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
      [order_id]
    );

    console.log(`[PAYMENT] Заказ #${order_id} оплачен. Комиссия: ${platform_fee} ₸`);

    res.json({
      success: true,
      transaction: transaction.rows[0]
    });
  } catch (err) {
    console.error('Ошибка платежа:', err);
    res.status(500).json({ error: 'Ошибка при проведении платежа' });
  }
});

module.exports = router;