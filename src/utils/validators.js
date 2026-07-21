'use strict';

// Small, dependency-free validation helpers shared across services.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { isEmail, isNonEmptyString };
