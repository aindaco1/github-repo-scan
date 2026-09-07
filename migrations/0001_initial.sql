CREATE TABLE runs (id TEXT PRIMARY KEY, scheduled_at TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, state TEXT NOT NULL DEFAULT 'collecting', policy_version TEXT, coverage_status TEXT, selected INTEGER NOT NULL DEFAULT 0, scanned INTEGER NOT NULL DEFAULT 0, private_scanned INTEGER NOT NULL DEFAULT 0, error_code TEXT, send_requested INTEGER NOT NULL DEFAULT 0, bundle_hash TEXT);
CREATE TABLE findings (id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, state TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE deliveries (run_id TEXT PRIMARY KEY REFERENCES runs(id), subject TEXT NOT NULL UNIQUE, recipient_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'prepared', attempted_at TEXT, message_id TEXT UNIQUE, delivered_at TEXT, error_code TEXT, updated_at TEXT NOT NULL);
CREATE TABLE email_events (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL, run_id TEXT REFERENCES runs(id));
CREATE INDEX runs_completed ON runs(completed_at);
CREATE INDEX deliveries_state ON deliveries(state);
CREATE INDEX email_events_message ON email_events(message_id);
