'use strict';

// Data-access layer for the USER supertype and its three subtype tables
// (STUDENT, MANAGER, SUPER_ADMIN). This is the ONLY module that runs SQL
// against them; services and controllers go through these functions.
const { db } = require('../../db');
const { ROLES } = require('../../config/constants');

// One projection used everywhere a user is read, so every layer sees the same
// shape whatever the role. The LEFT JOINs flatten the ISA hierarchy: a student
// row carries roll_no / room_number / hostel, a manager carries only a hostel,
// and a super admin carries neither (all NULL).
//
// Deliberately excludes password_hash — see findAuthByEmail for the one place
// that needs it.
const USER_SELECT = `
  SELECT u.user_id, u.name, u.email, u.role, u.created_at,
         s.roll_no,
         s.room_number,
         COALESCE(s.hostel_id, m.hostel_id) AS hostel_id,
         h.hostel_name
    FROM user u
    LEFT JOIN student s ON s.user_id  = u.user_id
    LEFT JOIN manager m ON m.user_id  = u.user_id
    LEFT JOIN hostel  h ON h.hostel_id = COALESCE(s.hostel_id, m.hostel_id)
`;

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Creates the USER row and its matching subtype row together.
//
// The pairing is design note DN-2: `user.role` claims which subtype exists,
// but SQL alone cannot enforce that the row is really there. Writing both
// inside one transaction is what makes the claim true — a half-created user
// is never visible to anything else.
function createUser({ name, email, passwordHash, role, rollNo = null, hostelId = null, roomNumber = null }) {
  return inTransaction(() => {
    const info = db
      .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, passwordHash, role);
    const userId = Number(info.lastInsertRowid);

    if (role === ROLES.STUDENT) {
      db.prepare(
        'INSERT INTO student (user_id, roll_no, hostel_id, room_number) VALUES (?, ?, ?, ?)'
      ).run(userId, rollNo, hostelId, roomNumber);
    } else if (role === ROLES.MANAGER) {
      db.prepare('INSERT INTO manager (user_id, hostel_id) VALUES (?, ?)').run(userId, hostelId);
    } else {
      db.prepare('INSERT INTO super_admin (user_id) VALUES (?)').run(userId);
    }

    return findById(userId);
  });
}

// Full row INCLUDING the password hash — used only to verify credentials.
// Kept separate from findById so that returning the hash requires deliberately
// choosing this function.
function findAuthByEmail(email) {
  return db
    .prepare(
      `SELECT u.user_id, u.name, u.email, u.password_hash, u.role, u.created_at,
              s.roll_no, s.room_number,
              COALESCE(s.hostel_id, m.hostel_id) AS hostel_id,
              h.hostel_name
         FROM user u
         LEFT JOIN student s ON s.user_id  = u.user_id
         LEFT JOIN manager m ON m.user_id  = u.user_id
         LEFT JOIN hostel  h ON h.hostel_id = COALESCE(s.hostel_id, m.hostel_id)
        WHERE u.email = ?`
    )
    .get(email);
}

// Public row (no hash) — safe to hand back to a client.
function findByEmail(email) {
  return db.prepare(`${USER_SELECT} WHERE u.email = ?`).get(email);
}

function findById(userId) {
  return db.prepare(`${USER_SELECT} WHERE u.user_id = ?`).get(userId);
}

function rollNoExists(rollNo) {
  return !!db.prepare('SELECT 1 FROM student WHERE roll_no = ?').get(rollNo);
}

// Updates the name on USER and, for a student, the room number on STUDENT.
// The STUDENT update simply affects no rows for a manager or super admin.
function updateProfile(userId, { name, roomNumber }) {
  return inTransaction(() => {
    db.prepare('UPDATE user SET name = ? WHERE user_id = ?').run(name, userId);
    if (roomNumber !== undefined) {
      db.prepare('UPDATE student SET room_number = ? WHERE user_id = ?').run(roomNumber, userId);
    }
    return findById(userId);
  });
}

// Lists students, optionally narrowed to one hostel.
//
// `hostelId` is how a manager is scoped: they pass their own hostel and see
// only its students, while a super admin passes nothing and sees everyone.
function listStudents({ hostelId = null } = {}) {
  if (hostelId) {
    return db
      .prepare(`${USER_SELECT} WHERE u.role = ? AND s.hostel_id = ? ORDER BY u.created_at DESC, u.user_id DESC`)
      .all(ROLES.STUDENT, hostelId);
  }
  return db
    .prepare(`${USER_SELECT} WHERE u.role = ? ORDER BY u.created_at DESC, u.user_id DESC`)
    .all(ROLES.STUDENT);
}

function countStudents({ hostelId = null } = {}) {
  if (hostelId) {
    return db
      .prepare('SELECT COUNT(*) AS n FROM student WHERE hostel_id = ?')
      .get(hostelId).n;
  }
  return db.prepare('SELECT COUNT(*) AS n FROM student').get().n;
}

// The hostel a member of staff is scoped to: a manager's own hostel, or null
// for a super admin (unscoped — sees every hostel).
//
// Read from the database rather than carried in the session token, so that
// reassigning or demoting a manager takes effect on their very next request
// instead of whenever their token happens to expire.
function findStaffHostelId(userId) {
  const row = db.prepare('SELECT hostel_id FROM manager WHERE user_id = ?').get(userId);
  return row ? row.hostel_id : null;
}

module.exports = {
  createUser,
  findAuthByEmail,
  findByEmail,
  findById,
  rollNoExists,
  updateProfile,
  listStudents,
  countStudents,
  findStaffHostelId,
};
