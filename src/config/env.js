'use strict';

// Loads environment variables from .env and exposes a single typed config object.
// Every other module imports configuration from here rather than reading
// process.env directly, so there is one place that defines defaults.
require('dotenv').config();

const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const isVercel = Boolean(process.env.VERCEL);
const databaseUrl = (process.env.TURSO_DATABASE_URL || '').trim();
const vercelRuntimeDir = path.join(os.tmpdir(), 'hostel-buddy');
const resolveFromRoot = (p, fallback) =>
  path.resolve(rootDir, p || fallback);

// How much of the request stream to print. See middleware/requestLogger.js.
// An unrecognised value falls back to the default rather than being treated as
// "none" — a typo in LOG_LEVEL should not silently turn logging off.
const LOG_LEVELS = ['none', 'api', 'all'];
const DEFAULT_LOG_LEVEL = 'api';

function readLogLevel(raw) {
  if (raw === undefined || raw === '') return DEFAULT_LOG_LEVEL;
  const value = String(raw).trim().toLowerCase();
  if (LOG_LEVELS.includes(value)) return value;
  console.warn(
    `[config] LOG_LEVEL="${raw}" is not one of ${LOG_LEVELS.join(', ')} — using "${DEFAULT_LOG_LEVEL}".`
  );
  return DEFAULT_LOG_LEVEL;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  isVercel,
  storageMode: databaseUrl ? (/^file:/.test(databaseUrl) ? 'persistent-libsql-file' : 'persistent-turso') : 'persistent-local',
  databaseUrl,
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN,
  allowDemoAdminPassword: process.env.ALLOW_DEMO_ADMIN_PASSWORD === 'true',

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '24h',

  // Seeded administrator account
  admin: {
    name: process.env.ADMIN_NAME || 'Hostel Administrator',
    email: process.env.ADMIN_EMAIL || 'admin@hostel.test',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  // Logging: 'api' (default), 'all', or 'none'
  logLevel: readLogLevel(process.env.LOG_LEVEL),

  // Storage
  // Local development uses SQLite; Vercel must use the remote database.
  // Attachments on Vercel are still temporary until object storage is added.
  dbPath: resolveFromRoot(
    process.env.DB_PATH,
    isVercel ? path.join(vercelRuntimeDir, 'hostel.db') : './data/hostel.db'
  ),
  uploadDir: resolveFromRoot(
    process.env.UPLOAD_DIR,
    isVercel ? path.join(vercelRuntimeDir, 'uploads') : './uploads'
  ),

  // Upload limits.
  //
  // Video gets its own, much larger ceiling: a phone clip of a leaking pipe is
  // an order of magnitude bigger than a photo of one. They are separate numbers
  // so raising the video cap never quietly raises the image cap too.
  //
  // The size cap is also the *only* deliberate limit on a video. Enforcing a
  // maximum duration would mean decoding container metadata on the server, and
  // a bitrate-independent byte ceiling bounds the storage cost just as well.
  maxUploadBytes: (isVercel ? 4 : 5) * 1024 * 1024,
  maxVideoBytes: (isVercel ? 4 : 30) * 1024 * 1024,
};

// In production, refuse to start on insecure defaults instead of only warning.
// A weak admin password requires an explicit demo-only opt-in. JWT and durable
// storage safeguards are never bypassed by this setting.
if (config.env === 'production' || isVercel) {
  const problems = [];
  if (!process.env.JWT_SECRET || ['dev-secret-change-me', 'change-me-to-a-long-random-secret'].includes(config.jwtSecret)) {
    problems.push('JWT_SECRET must be set to a strong, random value');
  } else if (config.jwtSecret.length < 16) {
    problems.push('JWT_SECRET is too short (use at least 16 characters)');
  }
  if (config.admin.password === 'admin123' && !config.allowDemoAdminPassword) {
    problems.push('ADMIN_PASSWORD must be changed from the default (or explicitly opt in with ALLOW_DEMO_ADMIN_PASSWORD=true for a class demo)');
  }
  if (isVercel && (!databaseUrl || !config.databaseAuthToken)) {
    problems.push('Vercel requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for durable accounts');
  }
  if (isVercel && !/^(libsql|https):\/\//.test(databaseUrl)) {
    problems.push('TURSO_DATABASE_URL must be a remote libsql:// or https:// URL');
  }
  if (problems.length) {
    throw new Error(
      '[config] Refusing to start in production with insecure settings:\n  - ' +
        problems.join('\n  - ')
    );
  }
  if (config.admin.password === 'admin123' && config.allowDemoAdminPassword) {
    console.warn('[config] Demo-only weak admin password enabled. Do not use real student data.');
  }
}

module.exports = config;
