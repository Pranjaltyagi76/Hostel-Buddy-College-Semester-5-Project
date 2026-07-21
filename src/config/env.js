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

  // Upload limits
  maxUploadBytes: 5 * 1024 * 1024, // 5 MB
};

// Warn loudly if security-relevant settings are left at their defaults.
if (config.env === 'production') {
  if (config.jwtSecret === 'dev-secret-change-me') {
    console.warn('[config] WARNING: JWT_SECRET is not set — using an insecure default.');
  }
  if (config.admin.password === 'admin123') {
    console.warn('[config] WARNING: ADMIN_PASSWORD is the default — change it before deploying.');
  }
}

module.exports = config;
