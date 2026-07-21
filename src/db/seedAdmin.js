'use strict';

// Idempotently ensures the single administrator account exists. Called on
// server startup; safe to run repeatedly (creates the admin only if absent).
const bcrypt = require('bcryptjs');
const usersRepo = require('../modules/users/users.repo');
const config = require('../config/env');
const { ROLES } = require('../config/constants');

function seedAdmin() {
  const email = config.admin.email.trim().toLowerCase();
  const existing = usersRepo.findByEmail(email);
  if (existing) return existing;

  const passwordHash = bcrypt.hashSync(config.admin.password, 10);
  const admin = usersRepo.createUser({
    name: config.admin.name,
    email,
    passwordHash,
    roomNumber: null,
    role: ROLES.ADMIN,
  });
  console.log(`[seed] administrator account created: ${admin.email}`);
  return admin;
}

module.exports = { seedAdmin };
