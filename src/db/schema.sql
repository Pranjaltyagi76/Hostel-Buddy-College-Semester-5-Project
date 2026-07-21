-- Hostel Buddy — database schema
-- Applied automatically on server startup (idempotent via IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  room_number   TEXT,
  role          TEXT    NOT NULL DEFAULT 'student'
                        CHECK (role IN ('student', 'admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  category      TEXT    NOT NULL
                        CHECK (category IN (
                          'Electricity', 'Plumbing', 'Water Supply', 'Wi-Fi',
                          'Cleaning', 'Furniture', 'Security', 'Other')),
  description   TEXT    NOT NULL,
  image_url     TEXT,
  status        TEXT    NOT NULL DEFAULT 'Pending'
                        CHECK (status IN (
                          'Pending', 'In Progress', 'Resolved', 'Closed')),
  admin_remarks TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);

-- Indexes backing the admin search/filter and the dashboard aggregations.
CREATE INDEX IF NOT EXISTS idx_complaints_user   ON complaints(user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_cat    ON complaints(category);
