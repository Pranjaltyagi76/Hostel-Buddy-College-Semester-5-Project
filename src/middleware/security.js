'use strict';

// Security hardening: HTTP security headers (helmet) and a rate limiter for the
// authentication endpoints.
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

// Content Security Policy tuned for this app:
//  - scripts only from our own origin (all page scripts are external files),
//  - inline styles allowed (pages use <style> blocks and style attributes),
//  - images from our origin plus data: URIs,
//  - no plugins, and framing limited to same origin.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  // Allow images/resources to be embedded by the same-origin frontend.
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

// Limit repeated auth attempts from one IP to slow brute-force attacks.
// Enabled in production only, so local development and the test suite are not
// throttled. Read/GET traffic is unaffected.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 login/register attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' } },
});

// A no-op passthrough used outside production.
const noLimit = (req, res, next) => next();

module.exports = {
  securityHeaders,
  authLimiter: config.env === 'production' ? authLimiter : noLimit,
};
