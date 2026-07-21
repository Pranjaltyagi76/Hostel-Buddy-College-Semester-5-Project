'use strict';

// Data-access layer for the users table. This is the ONLY module that runs
// SQL against `users`; services and controllers go through these functions.
const { db } = require('../../db');

// Columns safe to return to clients (never the password hash).
const PUBLIC_COLUMNS = 'id, name, email, room_number, role, created_at';

function createUser({ name, email, passwordHash, roomNumber = null, role = 'student' }) {
  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, room_number, role)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, email, passwordHash, roomNumber, role);
  return findById(Number(info.lastInsertRowid));
}

// Full row including password_hash — used only for authentication.
function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

// Public row (no hash) — safe to hand back to the client.
function findById(id) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id);
}

function updateProfile(id, { name, roomNumber = null }) {
  db.prepare('UPDATE users SET name = ?, room_number = ? WHERE id = ?').run(name, roomNumber, id);
  return findById(id);
}

function listStudents() {
  return db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = 'student' ORDER BY created_at DESC, id DESC`)
    .all();
}

function countStudents() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get().n;
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateProfile,
  listStudents,
  countStudents,
};
