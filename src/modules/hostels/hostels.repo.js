'use strict';

// Data-access layer for the HOSTEL table. Only this module runs SQL against it.
const { db } = require('../../db');

const COLUMNS = 'hostel_id, hostel_name, location, capacity, created_at';

function listAll() {
  return db.prepare(`SELECT ${COLUMNS} FROM hostel ORDER BY hostel_name`).all();
}

function findById(hostelId) {
  return db.prepare(`SELECT ${COLUMNS} FROM hostel WHERE hostel_id = ?`).get(hostelId);
}

function findByName(name) {
  return db.prepare(`SELECT ${COLUMNS} FROM hostel WHERE hostel_name = ?`).get(name);
}

function exists(hostelId) {
  return !!db.prepare('SELECT 1 FROM hostel WHERE hostel_id = ?').get(hostelId);
}

function create({ name, location = null, capacity = null }) {
  const info = db
    .prepare('INSERT INTO hostel (hostel_name, location, capacity) VALUES (?, ?, ?)')
    .run(name, location, capacity);
  return findById(Number(info.lastInsertRowid));
}

function update(hostelId, { name, location, capacity }) {
  db.prepare('UPDATE hostel SET hostel_name = ?, location = ?, capacity = ? WHERE hostel_id = ?')
    .run(name, location, capacity, hostelId);
  return findById(hostelId);
}

function remove(hostelId) {
  db.prepare('DELETE FROM hostel WHERE hostel_id = ?').run(hostelId);
}

// What currently depends on this hostel. Used to refuse a delete that would
// otherwise orphan people or complaints — the foreign keys would reject it
// anyway, but a counted, readable message is far more useful than a constraint
// error, and it tells the super admin exactly what to move first.
function usage(hostelId) {
  const one = (sql) => db.prepare(sql).get(hostelId).n;
  return {
    students: one('SELECT COUNT(*) AS n FROM student WHERE hostel_id = ?'),
    managers: one('SELECT COUNT(*) AS n FROM manager WHERE hostel_id = ?'),
    complaints: one('SELECT COUNT(*) AS n FROM complaint WHERE hostel_id = ?'),
  };
}

module.exports = { listAll, findById, findByName, exists, create, update, remove, usage };
