-- Hostel Buddy — database schema (v2)
-- Applied automatically on server startup (idempotent via IF NOT EXISTS).
--
-- Implements the ER model supplied by the course instructor:
--   USER  --ISA-->  STUDENT | MANAGER | SUPER_ADMIN
--   HOSTEL  1--N  COMPLAINT
--
-- Design rationale: docs/migration/PHASE-A-design.md
-- ============================================================================


-- ---------------------------------------------------------------------------
-- HOSTEL
-- Created before USER because the subtype tables reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hostel (
  hostel_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  hostel_name  TEXT    NOT NULL UNIQUE,
  location     TEXT,
  capacity     INTEGER CHECK (capacity IS NULL OR capacity > 0),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ---------------------------------------------------------------------------
-- USER  — the supertype of the ISA hierarchy.
--
-- `role` is the DISCRIMINATOR: it says which subtype table holds this user's
-- extra attributes. The specialization is DISJOINT (a user is exactly one of
-- the three) and TOTAL (every user is one of them).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL
                        CHECK (role IN ('student', 'manager', 'super_admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ---------------------------------------------------------------------------
-- STUDENT — subtype. PK is also the FK to USER (shared primary key).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student (
  user_id     INTEGER PRIMARY KEY
                      REFERENCES user(user_id) ON DELETE CASCADE,
  roll_no     TEXT    NOT NULL UNIQUE,
  hostel_id   INTEGER NOT NULL REFERENCES hostel(hostel_id),
  room_number TEXT
);


-- ---------------------------------------------------------------------------
-- MANAGER — subtype. hostel_id is what scopes a manager's authority:
-- a manager may only see and act on complaints belonging to this hostel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manager (
  user_id   INTEGER PRIMARY KEY
                    REFERENCES user(user_id) ON DELETE CASCADE,
  hostel_id INTEGER NOT NULL REFERENCES hostel(hostel_id)
);


-- ---------------------------------------------------------------------------
-- SUPER_ADMIN — subtype. Deliberately has no hostel_id: a super admin is
-- unscoped and manages every hostel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS super_admin (
  user_id INTEGER PRIMARY KEY
                  REFERENCES user(user_id) ON DELETE CASCADE
);


-- ---------------------------------------------------------------------------
-- COMPLAINT
--
-- student_id references STUDENT (not USER), so the database itself guarantees
-- that only a student can raise a complaint.
--
-- hostel_id records the hostel the complaint was raised AGAINST, at the time
-- it was raised. It is set by the server from the student's hostel and is
-- never accepted from the client. See design note DN-3.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint (
  complaint_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id          INTEGER NOT NULL REFERENCES student(user_id),
  hostel_id           INTEGER NOT NULL REFERENCES hostel(hostel_id),
  room_number         TEXT,
  category            TEXT    NOT NULL
                              CHECK (category IN (
                                'Electricity', 'Plumbing', 'Water Supply', 'Wi-Fi',
                                'Cleaning', 'Furniture', 'Security', 'Other')),
  problem_description TEXT    NOT NULL,
  image_url           TEXT,
  video_url           TEXT,
  status              TEXT    NOT NULL DEFAULT 'Pending'
                              CHECK (status IN (
                                'Pending', 'In Progress', 'Resolved', 'Closed')),
  admin_remarks       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT
);


-- ---------------------------------------------------------------------------
-- COMPLAINT_TRIAGE
--
-- Server-generated priority and SLA policy for one complaint. Kept as a
-- separate one-to-one table so the feature upgrades existing v2 databases
-- safely without an ALTER TABLE migration. Students cannot write these fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_triage (
  complaint_id INTEGER PRIMARY KEY
                       REFERENCES complaint(complaint_id) ON DELETE CASCADE,
  priority     TEXT    NOT NULL
                       CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  score        INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  sla_hours    INTEGER NOT NULL CHECK (sla_hours IN (2, 8, 24, 72)),
  sla_due_at   TEXT    NOT NULL,
  reason       TEXT    NOT NULL,
  assessed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ---------------------------------------------------------------------------
-- COMPLAINT_DUPLICATE_MATCH
--
-- Explainable links from a newly created/edited complaint to older active
-- complaints that crossed the duplicate threshold. Detection never deletes or
-- blocks a complaint; staff retain the final operational decision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_duplicate_match (
  complaint_id         INTEGER NOT NULL
                               REFERENCES complaint(complaint_id) ON DELETE CASCADE,
  matched_complaint_id INTEGER NOT NULL
                               REFERENCES complaint(complaint_id) ON DELETE CASCADE,
  similarity_score     INTEGER NOT NULL CHECK (similarity_score BETWEEN 0 AND 100),
  reason               TEXT    NOT NULL,
  detected_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (complaint_id, matched_complaint_id),
  CHECK (complaint_id <> matched_complaint_id)
);


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- A student opening "My Complaints".
CREATE INDEX IF NOT EXISTS idx_complaint_student ON complaint(student_id);

-- NEW and important: every manager query is filtered by hostel.
CREATE INDEX IF NOT EXISTS idx_complaint_hostel  ON complaint(hostel_id);

-- Status filter + dashboard counts.
CREATE INDEX IF NOT EXISTS idx_complaint_status  ON complaint(status);

-- Category filter + distribution chart.
CREATE INDEX IF NOT EXISTS idx_complaint_cat     ON complaint(category);

-- Super-admin dashboard activity trend: complaints raised and resolved over time.
CREATE INDEX IF NOT EXISTS idx_complaint_created ON complaint(created_at);
CREATE INDEX IF NOT EXISTS idx_complaint_resolved ON complaint(resolved_at);

-- Priority queue and SLA deadline views.
CREATE INDEX IF NOT EXISTS idx_triage_priority ON complaint_triage(priority);
CREATE INDEX IF NOT EXISTS idx_triage_due      ON complaint_triage(sla_due_at);

-- Duplicate-link lookups in both directions.
CREATE INDEX IF NOT EXISTS idx_duplicate_match_target
  ON complaint_duplicate_match(matched_complaint_id);

-- Listing the students of one hostel.
CREATE INDEX IF NOT EXISTS idx_student_hostel    ON student(hostel_id);

-- Resolving "which hostel does this manager belong to".
CREATE INDEX IF NOT EXISTS idx_manager_hostel    ON manager(hostel_id);
