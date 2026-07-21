'use strict';

// Single shared database connection (the data-access layer is the only code
// that talks to this module). Uses Node's built-in SQLite — no native build
// step, so classmates can run the project without any compiler toolchain.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

// Make sure the folder holding the database file exists.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);

// Enforce foreign keys and use write-ahead logging for better read concurrency.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

module.exports = db;
