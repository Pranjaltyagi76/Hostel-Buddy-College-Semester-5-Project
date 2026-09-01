'use strict';

// Authentication & authorization middleware.
//   requireAuth  — rejects requests without a valid Bearer token.
//   requireRole  — rejects authenticated users outside the allowed role(s).
//   requireStaff — shorthand for "manager or super admin".
const { verifyToken } = require('../utils/jwt');
const { AppError } = require('./errorHandler');
const { STAFF_ROLES } = require('../config/constants');

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

// Accepts one or several roles: requireRole(ROLES.STUDENT) or
// requireRole(ROLES.MANAGER, ROLES.SUPER_ADMIN).
//
// This replaces the single-role guard the two-role system used. Note what it
// deliberately does NOT do: it never decides *which hostel* a manager may act
// on. That is an ownership question, not a role question, so it belongs in the
// service layer where it holds for every caller.
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
    }
    if (!allowed.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403, 'FORBIDDEN'));
    }
    next();
  };
}

// Either administering role. Used by every endpoint that was admin-only under
// the previous two-role model.
const requireStaff = requireRole(...STAFF_ROLES);

module.exports = { requireAuth, requireRole, requireStaff };
