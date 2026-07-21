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

// Final error handler — must be registered last (4 args so Express treats it
// as an error handler).
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');

  // Unexpected server errors are logged with their stack for debugging.
  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      message: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
      code,
    },
  });
}

module.exports = { AppError, notFound, errorHandler };
