'use strict';

// Wires middleware and routes together into an Express application.
// Kept free of server-start concerns (see server.js) so it can be imported
// by tests as well.
const express = require('express');
const path = require('path');

const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// --- Global middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// --- Health check (Phase 0) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'hostel-buddy', time: new Date().toISOString() });
});

// --- API routes ---
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/users', require('./modules/users/users.routes'));
// app.use('/api/complaints', require('./modules/complaints/complaints.routes'));
// app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes'));

// Uploaded complaint images (served statically once Phase 2 adds them).
app.use('/uploads', express.static(require('./config/env').uploadDir));

// --- Static frontend ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- 404 for unmatched API routes + central error handler (must be last) ---
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
