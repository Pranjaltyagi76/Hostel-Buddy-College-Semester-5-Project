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
//  - video from our origin (complaint attachments are served from /uploads),
//  - no plugins, and framing limited to same origin.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      // Inherited from default-src anyway, but stated outright so the policy
      // records that <video> playback is intended.
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  // Allow images/resources to be embedded by the same-origin frontend.
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

// Limit repeated auth attempts from one IP to slow brute-force attacks.
//
// This is active in development too, because that is the environment the app
// is actually demonstrated in — protection that only exists in production is
// protection nobody ever sees working. Only the automated test run disables it.
//
// `skipSuccessfulRequests` means the counter tracks *failed* attempts, so a
// legitimate user signing in repeatedly is never locked out while a password
// guesser still is.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.env === 'production' ? 20 : 100, // failed attempts per window per IP
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' } },
});

// A no-op passthrough used by the automated test run.
const noLimit = (req, res, next) => next();

module.exports = {
  securityHeaders,
  authLimiter: config.env === 'test' ? noLimit : authLimiter,
};
