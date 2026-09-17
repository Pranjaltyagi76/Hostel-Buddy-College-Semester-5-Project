'use strict';

// Data-access layer for the COMPLAINT table. Only this module runs SQL
// against it.
//
// Every staff-facing query accepts an optional `hostelId`. That single
// parameter is what implements manager scoping: a manager passes their own
// hostel and sees nothing else, a super admin passes null and sees everything.
// Keeping it a query filter rather than a post-fetch filter means the rows a
// manager may not see are never loaded in the first place.
const { db } = require('../../db');

const SLA_STATE_SQL = `CASE
  WHEN c.resolved_at IS NOT NULL AND c.resolved_at <= t.sla_due_at THEN 'met'
  WHEN c.resolved_at IS NOT NULL THEN 'missed'
  WHEN datetime('now') > t.sla_due_at THEN 'overdue'
  ELSE 'on_track'
END`;

// One projection for every read, so the shape is identical whether a student
// is viewing their own complaint or a manager is scanning a list.
const COMPLAINT_SELECT = `
  SELECT c.complaint_id, c.student_id, c.hostel_id,
         c.category, c.problem_description, c.image_url, c.video_url,
         c.status, c.admin_remarks, c.created_at, c.updated_at, c.resolved_at,
         t.priority, t.score AS triage_score, t.sla_hours, t.sla_due_at,
         t.reason AS triage_reason, t.assessed_at AS triage_assessed_at,
         ${SLA_STATE_SQL} AS sla_state,
         (SELECT COUNT(*) FROM complaint_duplicate_match dm
           WHERE dm.complaint_id = c.complaint_id) AS duplicate_count,
         (SELECT GROUP_CONCAT(dm.matched_complaint_id, ',')
            FROM complaint_duplicate_match dm
           WHERE dm.complaint_id = c.complaint_id) AS duplicate_of_ids,
         u.name  AS student_name,
         u.email AS student_email,
         s.roll_no, c.room_number,
         h.hostel_name
    FROM complaint c
    JOIN student s ON s.user_id   = c.student_id
    JOIN user    u ON u.user_id   = c.student_id
    JOIN hostel  h ON h.hostel_id = c.hostel_id
    JOIN complaint_triage t ON t.complaint_id = c.complaint_id
`;

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function writeTriage(complaintId, triage) {
  db.prepare(
    `INSERT OR REPLACE INTO complaint_triage
       (complaint_id, priority, score, sla_hours, sla_due_at, reason, assessed_at)
     SELECT complaint_id, ?, ?, ?, datetime(created_at, ?), ?, datetime('now')
       FROM complaint
      WHERE complaint_id = ?`
  ).run(
    triage.priority,
    triage.score,
    triage.slaHours,
    `+${triage.slaHours} hours`,
    triage.reason,
    complaintId
  );
}

function writeDuplicateMatches(complaintId, matches = []) {
  db.prepare('DELETE FROM complaint_duplicate_match WHERE complaint_id = ?').run(complaintId);
  const insert = db.prepare(
    `INSERT INTO complaint_duplicate_match
       (complaint_id, matched_complaint_id, similarity_score, reason)
     VALUES (?, ?, ?, ?)`
  );
  for (const match of matches) {
    insert.run(complaintId, match.complaint_id, match.similarity_score, match.match_reason);
  }
}

// hostelId is supplied by the service from the student's own record — never
// from the request — so a client cannot file a complaint against another hostel.
function create({ studentId, hostelId, roomNumber = null, category, description, imageUrl = null, videoUrl = null, triage, duplicateMatches = [] }) {
  const complaintId = inTransaction(() => {
    const info = db
      .prepare(
        `INSERT INTO complaint
           (student_id, hostel_id, room_number, category, problem_description, image_url, video_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`
      )
      .run(studentId, hostelId, roomNumber, category, description, imageUrl, videoUrl);
    const id = Number(info.lastInsertRowid);
    writeTriage(id, triage);
    writeDuplicateMatches(id, duplicateMatches);
    return id;
  });
  return findById(complaintId);
}

function findById(complaintId) {
  return db.prepare(`${COMPLAINT_SELECT} WHERE c.complaint_id = ?`).get(complaintId);
}

function findByStudent(studentId) {
  return db
    .prepare(`${COMPLAINT_SELECT} WHERE c.student_id = ? ORDER BY c.created_at DESC, c.complaint_id DESC`)
    .all(studentId);
}

// Updates the student-editable fields and bumps updated_at. Status is never
// changed here — that is a staff-only operation.
function update(complaintId, { category, description, imageUrl = null, videoUrl = null, triage, duplicateMatches = [] }) {
  inTransaction(() => {
    db.prepare(
      `UPDATE complaint
          SET category = ?, problem_description = ?, image_url = ?, video_url = ?,
              updated_at = datetime('now')
        WHERE complaint_id = ?`
    ).run(category, description, imageUrl, videoUrl, complaintId);
    writeTriage(complaintId, triage);
    writeDuplicateMatches(complaintId, duplicateMatches);
  });
  return findById(complaintId);
}

function remove(complaintId) {
  db.prepare('DELETE FROM complaint WHERE complaint_id = ?').run(complaintId);
}

// Only recent, unresolved work can prevent a genuinely redundant submission.
// The service performs the explainable similarity calculation; this query
// merely supplies a bounded, hostel-scoped candidate set.
function findDuplicateCandidates({ hostelId, excludeComplaintId = null, days = 30, limit = 100 }) {
  const safeDays = Number.isInteger(days) && days > 0 && days <= 90 ? days : 30;
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 100;
  const exclude = excludeComplaintId ? 'AND c.complaint_id <> ?' : '';
  const params = [hostelId, `-${safeDays} days`];
  if (excludeComplaintId) params.push(excludeComplaintId);
  params.push(safeLimit);

  return db.prepare(
    `SELECT c.complaint_id, c.category, c.problem_description,
            c.status, c.created_at, c.room_number
       FROM complaint c
      WHERE c.hostel_id = ?
        AND c.status IN ('Pending', 'In Progress')
        AND c.created_at >= datetime('now', ?)
        ${exclude}
      ORDER BY c.created_at DESC, c.complaint_id DESC
      LIMIT ?`
  ).all(...params);
}

// --- Staff: search / filter across complaints ---

// SQL's LIKE treats % and _ as wildcards, so a search for a literal "%" would
// otherwise match every row. Escape those (and the escape character itself);
// each LIKE below pairs with an explicit ESCAPE clause.
const LIKE_ESCAPE = '\\';

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => LIKE_ESCAPE + char);
}

// Builds the WHERE clause and its parameters. Every value is bound, never
// interpolated.
function buildFilters({ q, category, status, priority, sla, hostelId }) {
  const clauses = [];
  const params = [];

  // The scoping filter. Applied first so it can never be reached around by a
  // search term the caller supplies.
  if (hostelId) {
    clauses.push('c.hostel_id = ?');
    params.push(hostelId);
  }
  if (category) {
    clauses.push('c.category = ?');
    params.push(category);
  }
  if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('t.priority = ?');
    params.push(priority);
  }
  if (sla) {
    clauses.push(`(${SLA_STATE_SQL}) = ?`);
    params.push(sla);
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim();
    const like = `%${escapeLike(term)}%`;
    const nameLike = "u.name LIKE ? ESCAPE '\\'";
    const rollLike = "s.roll_no LIKE ? ESCAPE '\\'";
    const roomLike = "c.room_number LIKE ? ESCAPE '\\'";
    if (/^\d+$/.test(term)) {
      // A number can match a complaint id as well as name/roll/room text.
      clauses.push(`(${nameLike} OR ${rollLike} OR ${roomLike} OR c.complaint_id = ?)`);
      params.push(like, like, like, Number(term));
    } else {
      clauses.push(`(${nameLike} OR ${rollLike} OR ${roomLike})`);
      params.push(like, like, like);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

// Returns a page of complaints plus the total matching the same filters.
//
// The requested page is clamped to the last page that actually exists, so the
// caller can never be handed "page 99999 of 4".
function search({ q, category, status, priority, sla, hostelId = null, page = 1, limit = 20 }) {
  const { where, params } = buildFilters({ q, category, status, priority, sla, hostelId });

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM complaint c
         JOIN student s ON s.user_id = c.student_id
         JOIN user    u ON u.user_id = c.student_id
         JOIN complaint_triage t ON t.complaint_id = c.complaint_id
         ${where}`
    )
    .get(...params).n;

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const offset = (effectivePage - 1) * limit;

  const rows = db
    .prepare(`${COMPLAINT_SELECT} ${where} ORDER BY c.created_at DESC, c.complaint_id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { rows, total, page: effectivePage, totalPages };
}

// --- Staff: change status / remarks ---
// setResolvedAt is decided by the service ("set once, the first time a
// complaint reaches Resolved or beyond"); this layer writes what it is told.
function updateStatus(complaintId, { status, adminRemarks = null, setResolvedAt = false }) {
  if (setResolvedAt) {
    db.prepare(
      `UPDATE complaint
          SET status = ?, admin_remarks = ?, updated_at = datetime('now'), resolved_at = datetime('now')
        WHERE complaint_id = ?`
    ).run(status, adminRemarks, complaintId);
  } else {
    db.prepare(
      `UPDATE complaint
          SET status = ?, admin_remarks = ?, updated_at = datetime('now')
        WHERE complaint_id = ?`
    ).run(status, adminRemarks, complaintId);
  }
  return findById(complaintId);
}

// --- Aggregations (used by the dashboard module) ---
// Counts are computed in SQL with GROUP BY rather than pulled into JS, so the
// payload stays tiny and the work is done by the engine best suited to it.
//
// Each takes the same optional hostelId, so a manager's dashboard describes
// their hostel and a super admin's describes the whole system.

function statusCountsForStudent(studentId) {
  return db
    .prepare('SELECT status, COUNT(*) AS n FROM complaint WHERE student_id = ? GROUP BY status')
    .all(studentId);
}

function totalCount(hostelId = null) {
  return hostelId
    ? db.prepare('SELECT COUNT(*) AS n FROM complaint WHERE hostel_id = ?').get(hostelId).n
    : db.prepare('SELECT COUNT(*) AS n FROM complaint').get().n;
}

function statusCounts(hostelId = null) {
  return hostelId
    ? db.prepare('SELECT status, COUNT(*) AS n FROM complaint WHERE hostel_id = ? GROUP BY status').all(hostelId)
    : db.prepare('SELECT status, COUNT(*) AS n FROM complaint GROUP BY status').all();
}

function categoryCounts(hostelId = null) {
  return hostelId
    ? db.prepare('SELECT category, COUNT(*) AS n FROM complaint WHERE hostel_id = ? GROUP BY category').all(hostelId)
    : db.prepare('SELECT category, COUNT(*) AS n FROM complaint GROUP BY category').all();
}

function priorityCounts(hostelId = null) {
  return hostelId
    ? db.prepare(
      `SELECT t.priority, COUNT(*) AS n
         FROM complaint c
         JOIN complaint_triage t ON t.complaint_id = c.complaint_id
        WHERE c.hostel_id = ?
        GROUP BY t.priority`
    ).all(hostelId)
    : db.prepare(
      `SELECT t.priority, COUNT(*) AS n
         FROM complaint c
         JOIN complaint_triage t ON t.complaint_id = c.complaint_id
        GROUP BY t.priority`
    ).all();
}

function slaCounts(hostelId = null) {
  const where = hostelId ? 'WHERE c.hostel_id = ?' : '';
  const params = hostelId ? [hostelId] : [];
  return db.prepare(
    `SELECT ${SLA_STATE_SQL} AS sla_state, COUNT(*) AS n
       FROM complaint c
       JOIN complaint_triage t ON t.complaint_id = c.complaint_id
       ${where}
      GROUP BY sla_state`
  ).all(...params);
}

function recent(limit = 5, hostelId = null) {
  const where = hostelId ? 'WHERE c.hostel_id = ?' : '';
  const params = hostelId ? [hostelId, limit] : [limit];
  return db
    .prepare(`${COMPLAINT_SELECT} ${where} ORDER BY c.created_at DESC, c.complaint_id DESC LIMIT ?`)
    .all(...params);
}

// One zero-filled row per UTC day for the super-admin activity chart.
// `resolved_at` is written only the first time a complaint reaches Resolved or
// Closed, so it measures completed work without double-counting later updates.
function dailyActivity(days = 30) {
  const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
  const startModifier = `-${safeDays - 1} days`;

  return db.prepare(
    `WITH RECURSIVE date_range(day) AS (
       SELECT date('now', ?)
       UNION ALL
       SELECT date(day, '+1 day')
         FROM date_range
        WHERE day < date('now')
     ),
     raised AS (
       SELECT date(created_at) AS day, COUNT(*) AS n
         FROM complaint
        WHERE created_at >= date('now', ?)
        GROUP BY date(created_at)
     ),
     resolved AS (
       SELECT date(resolved_at) AS day, COUNT(*) AS n
         FROM complaint
        WHERE resolved_at IS NOT NULL
          AND resolved_at >= date('now', ?)
        GROUP BY date(resolved_at)
     )
     SELECT d.day,
            COALESCE(r.n, 0) AS raised,
            COALESCE(x.n, 0) AS resolved
       FROM date_range d
       LEFT JOIN raised r ON r.day = d.day
       LEFT JOIN resolved x ON x.day = d.day
      ORDER BY d.day`
  ).all(startModifier, startModifier, startModifier);
}

// Ranks physical complaint clusters over a rolling period. A location is the
// hostel + registered room pair, so identical room numbers in different
// hostels never collapse into one hotspot. The previous equally sized period
// is included for trend detection.
function complaintHotspots(hostelId = null, days = 30, limit = 8) {
  const safeDays = [7, 30, 90].includes(days) ? days : 30;
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 20 ? limit : 8;
  const scopeClause = hostelId ? 'AND c.hostel_id = ?' : '';
  const params = [`-${safeDays * 2} days`];
  if (hostelId) params.push(hostelId);
  params.push(`-${safeDays} days`, `-${safeDays} days`, safeLimit);

  return db.prepare(
    `WITH base AS (
       SELECT c.complaint_id, c.hostel_id, h.hostel_name,
              COALESCE(NULLIF(TRIM(c.room_number), ''), 'Unspecified') AS room_number,
              c.category, c.status, c.created_at, c.resolved_at,
              t.priority, t.sla_due_at
         FROM complaint c
         JOIN hostel h ON h.hostel_id = c.hostel_id
         JOIN complaint_triage t ON t.complaint_id = c.complaint_id
        WHERE c.created_at >= datetime('now', ?)
          ${scopeClause}
     ),
     current_rows AS (
       SELECT * FROM base WHERE created_at >= datetime('now', ?)
     ),
     previous_rows AS (
       SELECT * FROM base WHERE created_at < datetime('now', ?)
     ),
     current_agg AS (
       SELECT hostel_id, hostel_name, room_number,
              COUNT(*) AS complaint_count,
              SUM(CASE WHEN status IN ('Pending', 'In Progress') THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN priority = 'Critical' THEN 1 ELSE 0 END) AS critical_count,
              SUM(CASE WHEN resolved_at IS NULL AND datetime('now') > sla_due_at THEN 1 ELSE 0 END) AS overdue_count,
              MAX(created_at) AS latest_created_at
         FROM current_rows
        GROUP BY hostel_id, hostel_name, room_number
     ),
     previous_agg AS (
       SELECT hostel_id, room_number, COUNT(*) AS previous_count
         FROM previous_rows
        GROUP BY hostel_id, room_number
     ),
     category_counts AS (
       SELECT hostel_id, room_number, category, COUNT(*) AS category_count
         FROM current_rows
        GROUP BY hostel_id, room_number, category
     ),
     category_ranked AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY hostel_id, room_number
         ORDER BY category_count DESC, category ASC
       ) AS category_rank
         FROM category_counts
     ),
     scored AS (
       SELECT a.*,
              COALESCE(p.previous_count, 0) AS previous_count,
              r.category AS dominant_category,
              r.category_count AS dominant_category_count,
              a.complaint_count + (a.open_count * 2) +
                (a.critical_count * 3) + (a.overdue_count * 3) AS risk_score
         FROM current_agg a
         LEFT JOIN previous_agg p
           ON p.hostel_id = a.hostel_id AND p.room_number = a.room_number
         JOIN category_ranked r
           ON r.hostel_id = a.hostel_id AND r.room_number = a.room_number
          AND r.category_rank = 1
     ),
     summarized AS (
       SELECT scored.*,
              COUNT(*) OVER () AS total_locations,
              SUM(complaint_count) OVER () AS period_complaints,
              SUM(CASE WHEN risk_score >= 7 THEN 1 ELSE 0 END) OVER () AS high_risk_locations
         FROM scored
     )
     SELECT *
       FROM summarized
      ORDER BY risk_score DESC, complaint_count DESC,
               latest_created_at DESC, hostel_name ASC, room_number ASC
      LIMIT ?`
  ).all(...params);
}

module.exports = {
  create,
  findById,
  findByStudent,
  update,
  remove,
  findDuplicateCandidates,
  search,
  updateStatus,
  statusCountsForStudent,
  totalCount,
  statusCounts,
  categoryCounts,
  priorityCounts,
  slaCounts,
  recent,
  dailyActivity,
  complaintHotspots,
};
