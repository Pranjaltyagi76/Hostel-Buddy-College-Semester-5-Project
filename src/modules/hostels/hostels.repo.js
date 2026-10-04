'use strict';

// Data-access layer for the HOSTEL table. Only this module runs SQL against it.
const { db } = require('../../db');

const COLUMNS = 'hostel_id, hostel_name, location, capacity, created_at';

async function listAll() {
  return (await db.prepare(`SELECT ${COLUMNS} FROM hostel ORDER BY hostel_name`).all());
}

async function findById(hostelId) {
  return (await db.prepare(`SELECT ${COLUMNS} FROM hostel WHERE hostel_id = ?`).get(hostelId));
}

async function findByName(name) {
  return (await db.prepare(`SELECT ${COLUMNS} FROM hostel WHERE hostel_name = ?`).get(name));
}

async function exists(hostelId) {
  return !!(await db.prepare('SELECT 1 FROM hostel WHERE hostel_id = ?').get(hostelId));
}

async function create({ name, location = null, capacity = null }) {
  const info = (await db
    .prepare('INSERT INTO hostel (hostel_name, location, capacity) VALUES (?, ?, ?)')
    .run(name, location, capacity));
  return (await findById(Number(info.lastInsertRowid)));
}

async function update(hostelId, { name, location, capacity }) {
  (await db.prepare('UPDATE hostel SET hostel_name = ?, location = ?, capacity = ? WHERE hostel_id = ?')
    .run(name, location, capacity, hostelId));
  return (await findById(hostelId));
}

async function remove(hostelId) {
  (await db.prepare('DELETE FROM hostel WHERE hostel_id = ?').run(hostelId));
}

// What currently depends on this hostel. Used to refuse a delete that would
// otherwise orphan people or complaints — the foreign keys would reject it
// anyway, but a counted, readable message is far more useful than a constraint
// error, and it tells the super admin exactly what to move first.
async function usage(hostelId) {
  const one = async (sql) => (await db.prepare(sql).get(hostelId)).n;
  return {
    students: await one('SELECT COUNT(*) AS n FROM student WHERE hostel_id = ?'),
    managers: await one('SELECT COUNT(*) AS n FROM manager WHERE hostel_id = ?'),
    complaints: await one('SELECT COUNT(*) AS n FROM complaint WHERE hostel_id = ?'),
  };
}

module.exports = { listAll, findById, findByName, exists, create, update, remove, usage };
