'use strict';

// Data-access layer for the complaints table. Only this module runs SQL
// against `complaints`.
const { db } = require('../../db');

const COLUMNS = `id, user_id, category, description, image_url, status,
                 admin_remarks, created_at, updated_at, resolved_at`;

function create({ userId, category, description, imageUrl = null }) {
  const info = db
    .prepare(
      `INSERT INTO complaints (user_id, category, description, image_url, status)
       VALUES (?, ?, ?, ?, 'Pending')`
    )
    .run(userId, category, description, imageUrl);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  return db.prepare(`SELECT ${COLUMNS} FROM complaints WHERE id = ?`).get(id);
}

function findByUser(userId) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM complaints WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(userId);
}

// Update the student-editable fields (category, description, image) and bump
// updated_at. Status is never changed here — that is an admin-only operation.
function update(id, { category, description, imageUrl = null }) {
  db.prepare(
    `UPDATE complaints
        SET category = ?, description = ?, image_url = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).run(category, description, imageUrl, id);
  return findById(id);
}

function remove(id) {
  db.prepare('DELETE FROM complaints WHERE id = ?').run(id);
}

// --- Admin: search / filter across all complaints ---

// Build the WHERE clause and its parameters from the admin's filters.
// Every value is passed as a bound parameter (no string interpolation).
function buildFilters({ q, category, status }) {
  const clauses = [];
  const params = [];

  if (category) {
    clauses.push('c.category = ?');
    params.push(category);
  }
  if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (q && String(q).trim()) {
    const term = String(q).trim();
    const like = `%${term}%`;
    if (/^\d+$/.test(term)) {
      // A number can match a complaint id as well as name/room text.
      clauses.push('(u.name LIKE ? OR u.room_number LIKE ? OR c.id = ?)');
      params.push(like, like, Number(term));
    } else {
      clauses.push('(u.name LIKE ? OR u.room_number LIKE ?)');
      params.push(like, like);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

// Returns a page of complaints (joined with student name/room) plus the total
// count matching the same filters, for pagination.
function search({ q, category, status, page = 1, limit = 20 }) {
  const { where, params } = buildFilters({ q, category, status });

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM complaints c JOIN users u ON u.id = c.user_id ${where}`)
    .get(...params).n;

  const offset = (page - 1) * limit;
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, u.name AS student_name, u.room_number, u.email AS student_email,
              c.category, c.description, c.image_url, c.status, c.admin_remarks,
              c.created_at, c.updated_at, c.resolved_at
         FROM complaints c
         JOIN users u ON u.id = c.user_id
         ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { rows, total };
}

// --- Admin: change status / remarks ---
// setResolvedAt is decided by the service ("set once, the first time a
// complaint becomes Resolved"); this layer just writes what it is told.
function updateStatus(id, { status, adminRemarks = null, setResolvedAt = false }) {
  if (setResolvedAt) {
    db.prepare(
      `UPDATE complaints
          SET status = ?, admin_remarks = ?, updated_at = datetime('now'), resolved_at = datetime('now')
        WHERE id = ?`
    ).run(status, adminRemarks, id);
  } else {
    db.prepare(
      `UPDATE complaints
          SET status = ?, admin_remarks = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(status, adminRemarks, id);
  }
  return findById(id);
}

module.exports = { create, findById, findByUser, update, remove, search, updateStatus };
