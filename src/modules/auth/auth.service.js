'use strict';

// Authentication business logic: register a student and log a user in.
// Enforces all account rules (unique email, password hashing, generic login
// errors) before touching the data layer.
const bcrypt = require('bcryptjs');
const usersRepo = require('../users/users.repo');
const { signToken } = require('../../utils/jwt');
const { isEmail } = require('../../utils/validators');
const { AppError } = require('../../middleware/errorHandler');
const { ROLES } = require('../../config/constants');

const BCRYPT_ROUNDS = 10;

// Build the { token, user } response from a public user row.
function toAuthResponse(user) {
  const token = signToken({ userId: user.id, role: user.role });
  return { token, user };
}

async function register({ name, email, password, room_number } = {}) {
  // --- validation (server is the source of truth) ---
  if (!name || !String(name).trim()) {
    throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
  }
  if (String(name).trim().length > 100) {
    throw new AppError('Name is too long (max 100 characters)', 400, 'VALIDATION_ERROR');
  }
  if (!isEmail(email)) {
    throw new AppError('A valid email address is required', 400, 'VALIDATION_ERROR');
  }
  if (!password || String(password).length < 6) {
    throw new AppError('Password must be at least 6 characters', 400, 'VALIDATION_ERROR');
  }
  if (room_number && String(room_number).trim().length > 20) {
    throw new AppError('Room number is too long (max 20 characters)', 400, 'VALIDATION_ERROR');
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // --- uniqueness ---
  if (usersRepo.findByEmail(normalizedEmail)) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
  }

  // --- create ---
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const user = usersRepo.createUser({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
    roomNumber: room_number ? String(room_number).trim() : null,
    role: ROLES.STUDENT,
  });

  return toAuthResponse(user);
}

async function login({ email, password } = {}) {
  // Same generic error for every failure mode to avoid user enumeration.
  const invalid = new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');

  if (!isEmail(email) || !password) throw invalid;

  const row = usersRepo.findByEmail(String(email).trim().toLowerCase());
  if (!row) throw invalid;

  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) throw invalid;

  // Strip the password hash before returning.
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    room_number: row.room_number,
    role: row.role,
    created_at: row.created_at,
  };
  return toAuthResponse(user);
}

module.exports = { register, login };
