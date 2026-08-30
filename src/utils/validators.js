'use strict';

// Small, dependency-free validation helpers shared across services.
//
// These check the *type* before doing anything else. Coercing with String()
// first is what let a JSON object through as the literal text "[object Object]";
// every caller now asks "is this actually a string?" up front.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bcrypt hashes at most 72 bytes and silently ignores the rest, so anything
// longer would give the user a false sense of a stronger password.
const MAX_PASSWORD_BYTES = 72;

function isString(value) {
  return typeof value === 'string';
}

function isEmail(value) {
  return isString(value) && EMAIL_RE.test(value.trim());
}

function isNonEmptyString(value) {
  return isString(value) && value.trim().length > 0;
}

// Byte length, not character count — a multi-byte character costs bcrypt more
// than one of its 72 bytes.
function byteLength(value) {
  return isString(value) ? Buffer.byteLength(value, 'utf8') : 0;
}

// Accepts the several ways a checkbox arrives: JSON true, or the strings a
// multipart form sends ("true", "1", "on").
function isTruthyFlag(value) {
  if (value === true) return true;
  if (!isString(value)) return false;
  return ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
}

module.exports = {
  MAX_PASSWORD_BYTES,
  isString,
  isEmail,
  isNonEmptyString,
  byteLength,
  isTruthyFlag,
};
