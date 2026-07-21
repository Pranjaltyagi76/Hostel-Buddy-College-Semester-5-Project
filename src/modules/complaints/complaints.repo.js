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

module.exports = { create, findById, findByUser, update, remove };
