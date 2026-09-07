-- Receipts outlive report retention so an old failed run cannot become new again.
CREATE TABLE reported_actions (action_key TEXT PRIMARY KEY, delivered_at TEXT NOT NULL);
ALTER TABLE deliveries ADD COLUMN actions_indexed INTEGER NOT NULL DEFAULT 0;
