'use strict';

// Authentication & authorization middleware.
// requireAuth  — rejects requests without a valid Bearer token.
// requireRole  — rejects authenticated users who lack the required role.
const { verifyToken } = require('../utils/jwt');
const { AppError } = require('./errorHandler');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { userId: payload.userId, role: payload.role };
    next();
  } catch (err) {
    next(new AppError('Invalid or expired session. Please log in again.', 401, 'UNAUTHENTICATED'));
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
    }
    if (req.user.role !== role) {
      return next(new AppError('You do not have permission to perform this action', 403, 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
