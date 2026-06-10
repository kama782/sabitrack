// routes/payments.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/create-payment', async (req, res) => {
  const { order_id, total_amount } = req.body;
  
  // Рассчитываем доли
  const platform_fee = total_amount * 0.10; // 10% комиссия
  const nanny_amount = total_amount - platform_fee;

  try {
    const result = await pool.query(
      `INSERT INTO transactions (order_id, total_amount, platform_fee, nanny_amount, status) 
       VALUES ($1, $2, $3, $4, 'completed') RETURNING *`,
      [order_id, total_amount, platform_fee, nanny_amount]
    );
    
    // Обновляем статус заказа
    await pool.query('UPDATE orders SET payment_status = $1 WHERE id = $2', ['paid', order_id]);

    res.json({ success: true, transaction: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;