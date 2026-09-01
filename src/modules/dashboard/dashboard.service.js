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

function studentDashboard(studentId) {
  const byStatus = zeroFilled(STATUSES, complaintsRepo.statusCountsForStudent(studentId), 'status');
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    total,
    pending: byStatus['Pending'],
    inProgress: byStatus['In Progress'],
    resolved: byStatus['Resolved'],
    closed: byStatus['Closed'],
  };
}

// The staff dashboard describes whatever the caller is allowed to see: a
// manager's own hostel, or the whole system for a super admin.
//
// The same hostel filter is threaded through every count, so the totals, the
// status breakdown, the category chart and the recent list all describe the
// same population. Scoping only some of them would produce a dashboard whose
// numbers contradict each other.
function adminDashboard(requester) {
  const hostelId = usersRepo.findStaffHostelId(requester.userId);
  const scope = hostelId ? usersRepo.findById(requester.userId) : null;

  return {
    scope: hostelId
      ? { hostel_id: hostelId, hostel_name: scope ? scope.hostel_name : null }
      : { hostel_id: null, hostel_name: null },
    totalStudents: usersRepo.countStudents({ hostelId }),
    totalComplaints: complaintsRepo.totalCount(hostelId),
    byStatus: zeroFilled(STATUSES, complaintsRepo.statusCounts(hostelId), 'status'),
    byCategory: zeroFilled(CATEGORIES, complaintsRepo.categoryCounts(hostelId), 'category'),
    recent: complaintsRepo.recent(5, hostelId),
  };
}

module.exports = { studentDashboard, adminDashboard };
