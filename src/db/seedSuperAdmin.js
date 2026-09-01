'use strict';

// Idempotently ensures the single super-administrator account exists. Called on
// server startup; safe to run repeatedly (creates the account only if absent).
//
// The super admin is deliberately unscoped — it has no hostel_id — so it sees
// and manages every hostel. Managers, by contrast, are tied to one hostel.
//
// This writes the USER row and its SUPER_ADMIN subtype row inside a single
// transaction. That pairing is design note DN-2: `user.role` claims which
// subtype exists, but SQL alone cannot enforce that the matching row is really
// there, so the two writes must succeed or fail together.
const bcrypt = require('bcryptjs');
const { db } = require('./index');
const config = require('../config/env');
const { ROLES } = require('../config/constants');

function seedSuperAdmin() {
  const email = config.admin.email.trim().toLowerCase();

  const existing = db.prepare('SELECT user_id, email FROM user WHERE email = ?').get(email);
  if (existing) return existing;

  const passwordHash = bcrypt.hashSync(config.admin.password, 10);

  db.exec('BEGIN');
  try {
    const info = db
      .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(config.admin.name, email, passwordHash, ROLES.SUPER_ADMIN);
    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO super_admin (user_id) VALUES (?)').run(userId);
    db.exec('COMMIT');
    console.log(`[seed] super administrator created: ${email}`);
    return { user_id: userId, email };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { seedSuperAdmin };
