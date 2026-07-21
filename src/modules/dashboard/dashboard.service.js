'use strict';

// Dashboard read-model. It owns no table of its own; it composes the counts
// exposed by the complaints and users repositories into the exact shapes the
// student and admin dashboards need.
const complaintsRepo = require('../complaints/complaints.repo');
const usersRepo = require('../users/users.repo');
const { STATUSES, CATEGORIES } = require('../../config/constants');

// Turn grouped rows like [{ status: 'Pending', n: 4 }] into a complete map
// with every expected key present and zero-filled (so charts never miss a bar).
function zeroFilled(keys, rows, keyField) {
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const row of rows) {
    if (row[keyField] in map) map[row[keyField]] = row.n;
  }
  return map;
}

function studentDashboard(userId) {
  const byStatus = zeroFilled(STATUSES, complaintsRepo.statusCountsForUser(userId), 'status');
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    total,
    pending: byStatus['Pending'],
    inProgress: byStatus['In Progress'],
    resolved: byStatus['Resolved'],
    closed: byStatus['Closed'],
  };
}

function adminDashboard() {
  return {
    totalStudents: usersRepo.countStudents(),
    totalComplaints: complaintsRepo.totalCount(),
    byStatus: zeroFilled(STATUSES, complaintsRepo.statusCounts(), 'status'),
    byCategory: zeroFilled(CATEGORIES, complaintsRepo.categoryCounts(), 'category'),
    recent: complaintsRepo.recent(5),
  };
}

module.exports = { studentDashboard, adminDashboard };
