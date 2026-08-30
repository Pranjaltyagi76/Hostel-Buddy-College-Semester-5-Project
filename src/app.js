'use strict';

// Wires middleware and routes together into an Express application.
// Kept free of server-start concerns (see server.js) so it can be imported
// by tests as well.
const express = require('express');
const path = require('path');

const config = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { securityHeaders, authLimiter } = require('./middleware/security');

const app = express();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Behind a reverse proxy every request arrives from the proxy's address, which
// would make the rate limiter treat all users as one client. Trust exactly one
// hop so it sees the real client IP. Only in production — trusting the header
// locally would let anyone spoof their address past the limiter.
if (config.env === 'production') {
  app.set('trust proxy', 1);
}

// --- Global middleware ---
app.use(securityHeaders); // security headers first, before any response is built
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// --- Health check (Phase 0) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'hostel-buddy', time: new Date().toISOString() });
});

// --- API routes ---
app.use('/api/auth', authLimiter, require('./modules/auth/auth.routes'));
app.use('/api/users', require('./modules/users/users.routes'));
app.use('/api/complaints', require('./modules/complaints/complaints.routes'));
app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes'));

// Uploaded complaint images, served statically.
// DECISION (v1): these files are public to anyone who has the URL — they are
// NOT gated behind the complaint's owner/admin check. This is an accepted
// trade-off for the project scope: filenames are long random hex (unguessable)
// and are only ever exposed inside access-controlled complaint views. A
// production system would stream images through an authorized route or use
// signed object-storage URLs. See docs/problems_faced_and_bugs_encountered.md (D4).
app.use('/uploads', express.static(config.uploadDir));

// --- Static frontend ---
app.use(express.static(PUBLIC_DIR));

// --- 404 handling ---
// Unmatched API routes get the standard JSON error shape; an unmatched page
// gets the app's own 404 page rather than Express's stock HTML error.
app.use('/api', notFound);
app.use((req, res) => {
  res.status(404);
  if (req.accepts('html')) {
    return res.sendFile(path.join(PUBLIC_DIR, '404.html'));
  }
  res.json({ error: { message: 'Resource not found.', code: 'NOT_FOUND' } });
});

// --- Central error handler (must be last) ---
app.use(errorHandler);

module.exports = app;
