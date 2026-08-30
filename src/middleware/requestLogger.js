'use strict';

// Request logger: method, path, status, duration.
//
// Verbose in development (every request, which is what you want while building),
// quiet in production (only 4xx/5xx, so a real failure is not buried under
// hundreds of successful requests), and silent under the test runner.
const config = require('../config/env');

function requestLogger(req, res, next) {
  if (config.env === 'test') return next();

  const start = Date.now();
  res.on('finish', () => {
    if (config.env === 'production' && res.statusCode < 400) return;
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} — ${ms}ms`);
  });
  next();
}

module.exports = requestLogger;
