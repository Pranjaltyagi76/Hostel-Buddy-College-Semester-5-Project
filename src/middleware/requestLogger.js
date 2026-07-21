'use strict';

// Lightweight request logger for development: method, path, status, duration.
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} — ${ms}ms`);
  });
  next();
}

module.exports = requestLogger;
