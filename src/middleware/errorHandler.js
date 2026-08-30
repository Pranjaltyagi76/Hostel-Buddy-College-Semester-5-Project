'use strict';

// Cross-cutting error handling: one place that turns any thrown error into a
// consistent JSON shape { error: { message, code } } with the right status.

// Application error carrying an HTTP status and a machine-readable code.
class AppError extends Error {
  constructor(message, status = 400, code = 'ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

// 404 handler for unmatched API routes.
function notFound(req, res, next) {
  next(new AppError('Resource not found', 404, 'NOT_FOUND'));
}

// Only an AppError carries a message we wrote for a user. Errors thrown by
// Express, body-parser or a driver carry internal detail ("Expected property
// name or '}' in JSON at position 1"), so those are replaced with a written
// message chosen by status. The machine-readable code is always preserved.
const GENERIC_MESSAGES = {
  400: 'The request could not be understood. Please check your input and try again.',
  401: 'Authentication required.',
  403: 'You do not have permission to perform this action.',
  404: 'Resource not found.',
  405: 'That action is not supported on this resource.',
  409: 'That request conflicts with the current state of this record.',
  413: 'That request is too large.',
  415: 'That file type is not supported.',
  429: 'Too many attempts. Please try again later.',
};

// Codes follow the same rule as messages: ours are stable and documented,
// a framework's ("entity.parse.failed") is internal detail.
const GENERIC_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function publicMessage(err, status) {
  if (status >= 500) return 'Something went wrong. Please try again.';
  if (err instanceof AppError) return err.message;
  return GENERIC_MESSAGES[status] || 'The request could not be completed.';
}

function publicCode(err, status) {
  if (status >= 500) return 'INTERNAL_ERROR';
  if (err instanceof AppError) return err.code;
  return GENERIC_CODES[status] || 'ERROR';
}

// Final error handler — must be registered last (4 args so Express treats it
// as an error handler).
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;

  // Unexpected server errors are logged with their stack for debugging.
  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      message: publicMessage(err, status),
      code: publicCode(err, status),
    },
  });
}

module.exports = { AppError, notFound, errorHandler };
