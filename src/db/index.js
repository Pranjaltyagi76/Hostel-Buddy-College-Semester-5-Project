'use strict';

// Database bootstrap: applies the schema on startup and re-exports the
// shared connection for the repositories.
const fs = require('fs');
const path = require('path');
const db = require('./connection');

// `room_number` is a historical snapshot used by hotspot analytics. Existing
// databases predate the column, so add it once and capture each complaint's
// current student room at migration time. New complaints write the snapshot
// directly and therefore never move when a profile is edited later.
function ensureComplaintRoomSnapshot() {
  const columns = db.prepare('PRAGMA table_info(complaint)').all();
  if (!columns.some((column) => column.name === 'room_number')) {
    db.exec('ALTER TABLE complaint ADD COLUMN room_number TEXT');
    db.exec(
      `UPDATE complaint
          SET room_number = (
            SELECT s.room_number FROM student s WHERE s.user_id = complaint.student_id
          )`
    );
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_complaint_hotspot ON complaint(hostel_id, room_number, created_at)'
  );
}

// Inserts triage rows for complaints created before the priority/SLA feature
// existed. It is idempotent: only complaints without a matching row are read.
function backfillComplaintTriage() {
  const { assessComplaint } = require('../modules/complaints/triage');
  const missing = db.prepare(
    `SELECT c.complaint_id, c.category, c.problem_description
       FROM complaint c
       LEFT JOIN complaint_triage t ON t.complaint_id = c.complaint_id
      WHERE t.complaint_id IS NULL`
  ).all();
  if (!missing.length) return 0;

  const insert = db.prepare(
    `INSERT INTO complaint_triage
       (complaint_id, priority, score, sla_hours, sla_due_at, reason)
     SELECT complaint_id, ?, ?, ?, datetime(created_at, ?), ?
       FROM complaint
      WHERE complaint_id = ?`
  );

  db.exec('BEGIN');
  try {
    for (const complaint of missing) {
      const result = assessComplaint({
        category: complaint.category,
        description: complaint.problem_description,
      });
      insert.run(
        result.priority,
        result.score,
        result.slaHours,
        `+${result.slaHours} hours`,
        result.reason,
        complaint.complaint_id
      );
    }
    db.exec('COMMIT');
    return missing.length;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  ensureComplaintRoomSnapshot();
  backfillComplaintTriage();
}

module.exports = { db, initSchema, backfillComplaintTriage };
