'use strict';

// Database bootstrap: applies the schema on startup and re-exports the
// shared connection for the repositories.
const fs = require('fs');
const path = require('path');
const db = require('./connection');

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

module.exports = { db, initSchema };
