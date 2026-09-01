'use strict';

// Authentication business logic: register a student and log a user in.
// Enforces all account rules (unique email, password hashing, generic login
// errors) before touching the data layer.
const bcrypt = require('bcryptjs');
const usersRepo = require('../users/users.repo');
const hostelsRepo = require('../hostels/hostels.repo');
const { signToken } = require('../../utils/jwt');
const { validateAccountFields } = require('../users/account.validation');
const {
  isEmail,
  isNonEmptyString,
  isString,
  toPositiveInt,
} = require('../../utils/validators');
const { AppError } = require('../../middleware/errorHandler');
const { ROLES } = require('../../config/constants');

const BCRYPT_ROUNDS = 10;

// Build the { token, user } response from a public user row.
//
// The token carries only identity and role. A manager's hostel is deliberately
// NOT included: their scope is an authorisation boundary, and baking it into a
// 24-hour token would mean a reassignment or demotion took up to a day to take
// effect. It is read from the database instead — one indexed lookup, always current.
function toAuthResponse(user) {
  const token = signToken({ userId: user.user_id, role: user.role });
  return { token, user };
}

async function register({ name, email, password, roll_no, hostel_id, room_number } = {}) {
  // --- validation (server is the source of truth) ---
  // Name, email and password rules are shared with manager provisioning so the
  // two creation paths cannot drift apart. Each check tests the type first, so
  // a non-string value is rejected rather than coerced into "[object Object]".
  const { name: cleanName, email: normalizedEmail } = validateAccountFields({ name, email, password });

  // Roll number identifies the student and is now required.
  if (!isNonEmptyString(roll_no)) {
    throw new AppError('Roll number is required', 400, 'VALIDATION_ERROR');
  }
  if (roll_no.trim().length > 20) {
    throw new AppError('Roll number is too long (max 20 characters)', 400, 'VALIDATION_ERROR');
  }
  // Every student belongs to exactly one hostel, so this is required too.
  const hostelId = toPositiveInt(hostel_id);
  if (hostelId === null) {
    throw new AppError('Please select a hostel', 400, 'VALIDATION_ERROR');
  }
  if (!hostelsRepo.exists(hostelId)) {
    throw new AppError('The selected hostel does not exist', 400, 'VALIDATION_ERROR');
  }
  // Room number is optional: absent, null, or blank all mean "not given".
  if (room_number !== undefined && room_number !== null && room_number !== '') {
    if (!isString(room_number)) {
      throw new AppError('Room number must be text', 400, 'VALIDATION_ERROR');
    }
    if (room_number.trim().length > 20) {
      throw new AppError('Room number is too long (max 20 characters)', 400, 'VALIDATION_ERROR');
    }
  }

  const normalizedRollNo = roll_no.trim();

  // --- uniqueness ---
  if (usersRepo.findByEmail(normalizedEmail)) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
  }
  if (usersRepo.rollNoExists(normalizedRollNo)) {
    throw new AppError('An account with this roll number already exists', 409, 'ROLL_NO_TAKEN');
  }

  // --- create ---
  // Self-registration always produces a STUDENT. Manager and super-admin
  // accounts are provisioned, never signed up for.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let user;
  try {
    user = usersRepo.createUser({
      name: cleanName,
      email: normalizedEmail,
      passwordHash,
      role: ROLES.STUDENT,
      rollNo: normalizedRollNo,
      hostelId,
      roomNumber: room_number ? room_number.trim() || null : null,
    });
  } catch (err) {
    // Backstop for the race between the checks above and this insert: the DB's
    // UNIQUE constraints are the source of truth, so map them to clean 409s.
    const message = String(err.message);
    if (message.includes('UNIQUE constraint failed: user.email')) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
    }
    if (message.includes('UNIQUE constraint failed: student.roll_no')) {
      throw new AppError('An account with this roll number already exists', 409, 'ROLL_NO_TAKEN');
    }
    throw err;
  }

  return toAuthResponse(user);
}

async function login({ email, password } = {}) {
  // Same generic error for every failure mode to avoid user enumeration.
  const invalid = new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');

  if (!isEmail(email) || !isString(password) || !password) throw invalid;

  // findAuthByEmail is the one lookup that returns the password hash.
  const row = usersRepo.findAuthByEmail(email.trim().toLowerCase());
  if (!row) throw invalid;

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) throw invalid;

  // Strip the password hash before returning. The remaining fields differ by
  // role: a student carries roll_no / room_number / hostel, a manager carries
  // a hostel, and a super admin carries neither.
  const user = {
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    roll_no: row.roll_no,
    room_number: row.room_number,
    hostel_id: row.hostel_id,
    hostel_name: row.hostel_name,
    created_at: row.created_at,
  };
  return toAuthResponse(user);
}

module.exports = { register, login };
