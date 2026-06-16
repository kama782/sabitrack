const pool = require('./db');

const BADGES = {
  nanny: [
    { code: 'first_order', name: 'Первый заказ', icon: '🎯', check: (stats) => stats.total_orders >= 1 },
    { code: 'ten_orders', name: 'Опытная няня', icon: '⭐', check: (stats) => stats.total_orders >= 10 },
    { code: 'fifty_orders', name: 'Ветеран', icon: '💎', check: (stats) => stats.total_orders >= 50 },
    { code: 'top_rating', name: 'Топ рейтинг', icon: '🏆', check: (stats) => stats.rating >= 4.5 },
    { code: 'video_added', name: 'Видео-визитка', icon: '🎬', check: (stats) => stats.has_video },
  ],
  parent: [
    { code: 'first_order', name: 'Первый заказ', icon: '🎯', check: (stats) => stats.total_orders >= 1 },
    { code: 'five_orders', name: 'Постоянный клиент', icon: '🤝', check: (stats) => stats.total_orders >= 5 },
    { code: 'three_reviews', name: 'Активный родитель', icon: '❤️', check: (stats) => stats.total_reviews >= 3 },
  ]
};

async function checkAndAwardBadges(user_id, role) {
  try {
    let stats = {};
    if (role === 'nanny') {
      const orders = await pool.query(
        `SELECT COUNT(*) as total FROM orders WHERE nanny_id = $1 AND status = 'Завершён'`, [user_id]
      );
      const nanny = await pool.query(`SELECT rating, video_presentation FROM nannies WHERE id = $1`, [user_id]);
      stats.total_orders = parseInt(orders.rows[0].total);
      stats.rating = parseFloat(nanny.rows[0]?.rating || 0);
      stats.has_video = !!nanny.rows[0]?.video_presentation;
    } else if (role === 'parent') {
      const orders = await pool.query(
        `SELECT COUNT(*) as total FROM orders WHERE parent_id = $1`, [user_id]
      );
      const reviews = await pool.query(
        `SELECT COUNT(*) as total FROM reviews WHERE parent_id = $1`, [user_id]
      );
      stats.total_orders = parseInt(orders.rows[0].total);
      stats.total_reviews = parseInt(reviews.rows[0].total);
    }

    const badges = BADGES[role] || [];
    let pointsToAdd = 0;

    for (const badge of badges) {
      if (badge.check(stats)) {
        const exists = await pool.query(
          `SELECT id FROM achievements WHERE user_id = $1 AND role = $2 AND badge_code = $3`,
          [user_id, role, badge.code]
        );
        if (exists.rows.length === 0) {
          await pool.query(
            `INSERT INTO achievements (user_id, role, badge_code, badge_name, badge_icon) VALUES ($1,$2,$3,$4,$5)`,
            [user_id, role, badge.code, badge.name, badge.icon]
          );
          pointsToAdd += 100;
        }
      }
    }

    if (pointsToAdd > 0) {
      const table = role === 'nanny' ? 'nannies' : 'parents';
      await pool.query(`UPDATE ${table} SET points = points + $1 WHERE id = $2`, [pointsToAdd, user_id]);
    }
  } catch (err) {
    console.error('Ошибка начисления достижений:', err);
  }
}

module.exports = { checkAndAwardBadges };