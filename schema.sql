-- SabiTrack Database Schem --
-- psql -U postgres -d sabitrack -f schema.sql

CREATE TABLE IF NOT EXISTS parents (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nannies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  experience INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'На проверке',
  rating DECIMAL(3,2) DEFAULT NULL,
  available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS children (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  age INTEGER,
  features TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES parents(id),
  nanny_id INTEGER REFERENCES nannies(id),
  child_id INTEGER REFERENCES children(id),
  order_type VARCHAR(20) DEFAULT 'Плановый',
  status VARCHAR(30) DEFAULT 'Ожидает',
  date_start TIMESTAMP,
  date_end TIMESTAMP,
  amount DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  method VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  parent_id INTEGER REFERENCES parents(id),
  nanny_id INTEGER REFERENCES nannies(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed: admin по умолчанию (пароль: password)
INSERT INTO admins (name, email, password_hash)
VALUES ('Администратор', 'admin@sabitrack.kz', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (email) DO NOTHING;

-- ── ДОКУМЕНТЫ НЯНЬ ──
CREATE TABLE IF NOT EXISTS nanny_documents (
  id          SERIAL PRIMARY KEY,
  nanny_id    INTEGER REFERENCES nannies(id) ON DELETE CASCADE,
  doc_type    VARCHAR(60)  NOT NULL,  -- 'diploma','certificate','id','other'
  title       VARCHAR(120) NOT NULL,
  file_data   TEXT         NOT NULL,  -- base64 data URL
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(80)  NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── СООБЩЕНИЯ (мессенджер) ──
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  sender_role VARCHAR(20)  NOT NULL,  -- 'parent' | 'nanny'
  sender_id   INTEGER      NOT NULL,
  sender_name VARCHAR(100) NOT NULL,
  text        TEXT         NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, created_at);



-- Добавляем в schema.sql
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  parent_id INTEGER REFERENCES parents(id),
  nanny_id INTEGER REFERENCES nannies(id),
  total_amount DECIMAL(10, 2) NOT NULL,    -- Полная сумма (100%)
  platform_fee DECIMAL(10, 2) NOT NULL,    -- Ваша комиссия (10%)
  nanny_amount DECIMAL(10, 2) NOT NULL,    -- То, что получит няня (90%)
  status VARCHAR(20) DEFAULT 'pending',     -- pending, completed, refunded
  created_at TIMESTAMP DEFAULT NOW()
);

-- Можно добавить колонку в существующую таблицу заказов
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid';

-- ── КОШЕЛЬКИ ──
-- Баланс родителя
ALTER TABLE parents ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0.00;
-- Баланс няни (то что она уже заработала)
ALTER TABLE nannies ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0.00;
-- Баланс (касса) платформы — для admins хранится в отдельной таблице
CREATE TABLE IF NOT EXISTS platform_wallet (
  id         SERIAL PRIMARY KEY,
  balance    DECIMAL(12,2) DEFAULT 0.00,
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Одна запись — касса платформы
INSERT INTO platform_wallet (balance) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM platform_wallet);

-- ── ИСТОРИЯ ТРАНЗАКЦИЙ (расширенная) ──
DROP TABLE IF EXISTS transactions;
CREATE TABLE IF NOT EXISTS transactions (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER REFERENCES orders(id),
  parent_id       INTEGER REFERENCES parents(id),
  nanny_id        INTEGER REFERENCES nannies(id),
  type            VARCHAR(30) NOT NULL, -- 'topup','payment','payout'
  total_amount    DECIMAL(10,2) NOT NULL,
  platform_fee    DECIMAL(10,2) DEFAULT 0,
  nanny_amount    DECIMAL(10,2) DEFAULT 0,
  description     TEXT,
  status          VARCHAR(20) DEFAULT 'completed',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── ПОПОЛНЕНИЯ БАЛАНСА ──
CREATE TABLE IF NOT EXISTS topups (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  user_role   VARCHAR(20) NOT NULL, -- 'parent'|'nanny'
  amount      DECIMAL(10,2) NOT NULL,
  method      VARCHAR(30) DEFAULT 'card', -- 'card','kaspi'
  status      VARCHAR(20) DEFAULT 'completed',
  created_at  TIMESTAMP DEFAULT NOW()
);

UPDATE orders 
SET status = 'Отклонено' 
WHERE status = 'Ожидает' 
  AND nanny_id = 5             -- ID няни вместо $1
  AND id != 10                 -- ID принятого заказа вместо $2
  AND date_start < ('2026-04-12 20:00:00'::timestamp + interval '30 minutes') -- конец заказа вместо $3
  AND date_end > ('2026-04-12 18:00:00'::timestamp - interval '30 minutes');  -- начало заказа вместо $4