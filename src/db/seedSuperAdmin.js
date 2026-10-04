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

async function seedSuperAdmin() {
  const email = config.admin.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(config.admin.password, 10);
  return db.transaction(async () => {
    // Check inside the write transaction: simultaneous cold starts create one
    // account. Env password changes must never silently reset an existing user.
    const existing = await db.prepare('SELECT user_id, email, role FROM user WHERE email = ?').get(email);
    if (existing) {
      if (existing.role !== ROLES.SUPER_ADMIN) {
        throw new Error('ADMIN_EMAIL belongs to a non-admin account; choose a different email');
      }
      return existing;
    }
    const info = await db
      .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(config.admin.name, email, passwordHash, ROLES.SUPER_ADMIN);
    const userId = Number(info.lastInsertRowid);
    await db.prepare('INSERT INTO super_admin (user_id) VALUES (?)').run(userId);
    console.log(`[seed] super administrator created: ${email}`);
    return { user_id: userId, email };
  });
}

module.exports = { seedSuperAdmin };
