const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'sabitrack',
  user: 'postgres',
  password: '060510', // Пишем пароль напрямую здесь
});

pool.on('connect', () => {
  console.log('✅ Успешное подключение к PostgreSQL!');
});

pool.on('error', (err) => {
  console.error('❌ Ошибка PostgreSQL:', err.message);
});

module.exports = pool;