'use strict';

// Account rules shared by the two ways a user comes into existence:
// a student registering themselves, and a super admin provisioning a manager.
//
// Kept in one place deliberately. These include the password policy, and a
// policy that lives in two files is a policy that will eventually differ in
// two files — which is how B15 (bcrypt silently truncating long passwords)
// became possible in the first place.
const { AppError } = require('../../middleware/errorHandler');
const {
  isEmail,
  isNonEmptyString,
  isString,
  byteLength,
  MAX_PASSWORD_BYTES,
} = require('../../utils/validators');

// Validates name, email and password. Returns the normalised name and email so
// callers cannot forget to trim or lower-case them.
function validateAccountFields({ name, email, password }) {
  if (!isNonEmptyString(name)) {
    throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
  }
  if (name.trim().length > 100) {
    throw new AppError('Name is too long (max 100 characters)', 400, 'VALIDATION_ERROR');
  }
  if (!isEmail(email)) {
    throw new AppError('A valid email address is required', 400, 'VALIDATION_ERROR');
  }
  if (!isString(password) || password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400, 'VALIDATION_ERROR');
  }
  if (byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new AppError(
      `Password is too long (max ${MAX_PASSWORD_BYTES} characters)`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return { name: name.trim(), email: email.trim().toLowerCase() };
}

module.exports = { validateAccountFields };
