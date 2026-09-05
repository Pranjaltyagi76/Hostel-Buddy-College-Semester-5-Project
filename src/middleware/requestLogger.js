'use strict';

// Request logger: method, path, status, duration.
//
// A page view pulls in a stylesheet, four scripts and a vendored chart library,
// so logging every request buried the one line that mattered — the API call —
// under seven that never did. What is worth seeing is the conversation with the
// API, plus anything that failed.
//
// `LOG_LEVEL` chooses how much of that to print:
//   api  (default) — every /api request, plus any other request that failed
//   all            — every request, static assets included
//   none           — silence
//
// Production narrows this further to failures only, so a real error is not lost
// among hundreds of successful requests. The test runner is always silent.
const config = require('../config/env');

const isApiRequest = (req) => req.path.startsWith('/api');

// Decides whether one finished request is worth a line.
function shouldLog(req, statusCode) {
  if (config.logLevel === 'none') return false;

  // A failure is always worth seeing, whatever it was for — that is how a
  // missing asset or a broken route gets noticed at all.
  const failed = statusCode >= 400;

  if (config.env === 'production') return failed;
  if (config.logLevel === 'all') return true;
  return isApiRequest(req) || failed;
}

function requestLogger(req, res, next) {
  if (config.env === 'test') return next();

  const start = Date.now();
  res.on('finish', () => {
    if (!shouldLog(req, res.statusCode)) return;
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} — ${ms}ms`);
  });
  next();
}

module.exports = requestLogger;
