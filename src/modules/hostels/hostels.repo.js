'use strict';

// Data-access layer for the HOSTEL table. Only this module runs SQL against it.
const { db } = require('../../db');

const COLUMNS = 'hostel_id, hostel_name, location, capacity, created_at';

function listAll() {
  return db.prepare(`SELECT ${COLUMNS} FROM hostel ORDER BY hostel_name`).all();
}

function findById(hostelId) {
  return db.prepare(`SELECT ${COLUMNS} FROM hostel WHERE hostel_id = ?`).get(hostelId);
}

function exists(hostelId) {
  return !!db.prepare('SELECT 1 FROM hostel WHERE hostel_id = ?').get(hostelId);
}

module.exports = { listAll, findById, exists };
