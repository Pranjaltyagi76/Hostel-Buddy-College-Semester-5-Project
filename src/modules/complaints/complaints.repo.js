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

// One projection for every read, so the shape is identical whether a student
// is viewing their own complaint or a manager is scanning a list.
const COMPLAINT_SELECT = `
  SELECT c.complaint_id, c.student_id, c.hostel_id,
         c.category, c.problem_description, c.image_url, c.video_url,
         c.status, c.admin_remarks, c.created_at, c.updated_at, c.resolved_at,
         u.name  AS student_name,
         u.email AS student_email,
         s.roll_no, s.room_number,
         h.hostel_name
    FROM complaint c
    JOIN student s ON s.user_id   = c.student_id
    JOIN user    u ON u.user_id   = c.student_id
    JOIN hostel  h ON h.hostel_id = c.hostel_id
`;

// hostelId is supplied by the service from the student's own record — never
// from the request — so a client cannot file a complaint against another hostel.
function create({ studentId, hostelId, category, description, imageUrl = null, videoUrl = null }) {
  const info = db
    .prepare(
      `INSERT INTO complaint (student_id, hostel_id, category, problem_description, image_url, video_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending')`
    )
    .run(studentId, hostelId, category, description, imageUrl, videoUrl);
  return findById(Number(info.lastInsertRowid));
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
function update(complaintId, { category, description, imageUrl = null, videoUrl = null }) {
  db.prepare(
    `UPDATE complaint
        SET category = ?, problem_description = ?, image_url = ?, video_url = ?,
            updated_at = datetime('now')
      WHERE complaint_id = ?`
  ).run(category, description, imageUrl, videoUrl, complaintId);
  return findById(complaintId);
}

function remove(complaintId) {
  db.prepare('DELETE FROM complaint WHERE complaint_id = ?').run(complaintId);
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
function buildFilters({ q, category, status, hostelId }) {
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
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim();
    const like = `%${escapeLike(term)}%`;
    const nameLike = "u.name LIKE ? ESCAPE '\\'";
    const rollLike = "s.roll_no LIKE ? ESCAPE '\\'";
    const roomLike = "s.room_number LIKE ? ESCAPE '\\'";
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
function search({ q, category, status, hostelId = null, page = 1, limit = 20 }) {
  const { where, params } = buildFilters({ q, category, status, hostelId });

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM complaint c
         JOIN student s ON s.user_id = c.student_id
         JOIN user    u ON u.user_id = c.student_id
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

function recent(limit = 5, hostelId = null) {
  const where = hostelId ? 'WHERE c.hostel_id = ?' : '';
  const params = hostelId ? [hostelId, limit] : [limit];
  return db
    .prepare(`${COMPLAINT_SELECT} ${where} ORDER BY c.created_at DESC, c.complaint_id DESC LIMIT ?`)
    .all(...params);
}

module.exports = {
  create,
  findById,
  findByStudent,
  update,
  remove,
  search,
  updateStatus,
  statusCountsForStudent,
  totalCount,
  statusCounts,
  categoryCounts,
  recent,
};
