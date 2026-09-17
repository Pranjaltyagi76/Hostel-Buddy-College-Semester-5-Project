'use strict';

// Dashboard read-model. It owns no table of its own; it composes the counts
// exposed by the complaints and users repositories into the exact shapes the
// student and admin dashboards need.
const complaintsRepo = require('../complaints/complaints.repo');
const usersRepo = require('../users/users.repo');
const { STATUSES, CATEGORIES, ROLES } = require('../../config/constants');
const { PRIORITIES, SLA_STATES } = require('../complaints/triage');

const ACTIVITY_DAYS = 30;

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

  const dashboard = {
    scope: hostelId
      ? { hostel_id: hostelId, hostel_name: scope ? scope.hostel_name : null }
      : { hostel_id: null, hostel_name: null },
    totalStudents: usersRepo.countStudents({ hostelId }),
    totalComplaints: complaintsRepo.totalCount(hostelId),
    byStatus: zeroFilled(STATUSES, complaintsRepo.statusCounts(hostelId), 'status'),
    byCategory: zeroFilled(CATEGORIES, complaintsRepo.categoryCounts(hostelId), 'category'),
    byPriority: zeroFilled(PRIORITIES, complaintsRepo.priorityCounts(hostelId), 'priority'),
    sla: zeroFilled(SLA_STATES, complaintsRepo.slaCounts(hostelId), 'sla_state'),
    recent: complaintsRepo.recent(5, hostelId),
  };

  // Only a super admin sees the institution-wide raised-versus-resolved
  // activity trend. Managers keep their existing hostel-scoped dashboard.
  if (requester.role === ROLES.SUPER_ADMIN) {
    const daily = complaintsRepo.dailyActivity(ACTIVITY_DAYS);
    dashboard.activity = {
      periodDays: ACTIVITY_DAYS,
      raisedTotal: daily.reduce((total, row) => total + row.raised, 0),
      resolvedTotal: daily.reduce((total, row) => total + row.resolved, 0),
      daily,
    };
  }

  return dashboard;
}

module.exports = { studentDashboard, adminDashboard };
