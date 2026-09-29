ALTER TABLE users RENAME COLUMN stripe_customer_id TO dodo_customer_id;
ALTER TABLE users ADD COLUMN dodo_subscription_id TEXT;
ALTER TABLE users ADD COLUMN dodo_event_at INTEGER;
CREATE UNIQUE INDEX idx_users_dodo_customer ON users(dodo_customer_id) WHERE dodo_customer_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_dodo_subscription ON users(dodo_subscription_id) WHERE dodo_subscription_id IS NOT NULL;
