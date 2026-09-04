'use strict';

// Loads environment variables from .env and exposes a single typed config object.
// Every other module imports configuration from here rather than reading
// process.env directly, so there is one place that defines defaults.
require('dotenv').config();

const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const resolveFromRoot = (p, fallback) =>
  path.resolve(rootDir, p || fallback);

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '24h',

  // Seeded administrator account
  admin: {
    name: process.env.ADMIN_NAME || 'Hostel Administrator',
    email: process.env.ADMIN_EMAIL || 'admin@hostel.test',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  // Storage
  dbPath: resolveFromRoot(process.env.DB_PATH, './data/hostel.db'),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR, './uploads'),

  // Upload limits.
  //
  // Video gets its own, much larger ceiling: a phone clip of a leaking pipe is
  // an order of magnitude bigger than a photo of one. They are separate numbers
  // so raising the video cap never quietly raises the image cap too.
  //
  // The size cap is also the *only* deliberate limit on a video. Enforcing a
  // maximum duration would mean decoding container metadata on the server, and
  // a bitrate-independent byte ceiling bounds the storage cost just as well.
  maxUploadBytes: 5 * 1024 * 1024, // 5 MB  — images
  maxVideoBytes: 30 * 1024 * 1024, // 30 MB — video
};

// In production, refuse to start on insecure defaults instead of only warning.
// A graded/deployed demo must never boot with a guessable secret or password.
if (config.env === 'production') {
  const problems = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === 'dev-secret-change-me') {
    problems.push('JWT_SECRET must be set to a strong, random value');
  } else if (config.jwtSecret.length < 16) {
    problems.push('JWT_SECRET is too short (use at least 16 characters)');
  }
  if (config.admin.password === 'admin123') {
    problems.push('ADMIN_PASSWORD must be changed from the default');
  }
  if (problems.length) {
    throw new Error(
      '[config] Refusing to start in production with insecure settings:\n  - ' +
        problems.join('\n  - ')
    );
  }
}

module.exports = config;
