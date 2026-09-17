'use strict';

// Dashboard read-model. It owns no table of its own; it composes the counts
// exposed by the complaints and users repositories into the exact shapes the
// student and admin dashboards need.
const complaintsRepo = require('../complaints/complaints.repo');
const usersRepo = require('../users/users.repo');
const { STATUSES, CATEGORIES, ROLES } = require('../../config/constants');
const { PRIORITIES, SLA_STATES } = require('../complaints/triage');
const { AppError } = require('../../middleware/errorHandler');

const ACTIVITY_DAYS = 30;
const HOTSPOT_PERIODS = [7, 30, 90];

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

function riskLevel(score) {
  if (score >= 12) return 'Critical';
  if (score >= 7) return 'High';
  if (score >= 3) return 'Watch';
  return 'Normal';
}

function trendFor(current, previous) {
  if (previous === 0 && current > 0) return 'new';
  if (current > previous) return 'rising';
  if (current < previous) return 'easing';
  return 'steady';
}

function recommendedAction(row) {
  if (row.critical_count > 0) {
    return `Inspect immediately; ${row.critical_count} Critical case${row.critical_count === 1 ? '' : 's'} detected.`;
  }
  if (row.overdue_count > 0) {
    return `Escalate ${row.overdue_count} overdue case${row.overdue_count === 1 ? '' : 's'} and inspect the recurring fault.`;
  }
  if (row.complaint_count >= 3) {
    return `Schedule a preventive ${row.dominant_category.toLowerCase()} inspection.`;
  }
  return 'Monitor this location for recurrence.';
}

// Complaint hotspot analytics is deliberately separate from the standard
// dashboard payload: the period can be changed without reloading every chart.
// The repository receives the caller's resolved hostel scope, never one from
// the query string.
function complaintHotspots(requester, requestedDays) {
  const days = requestedDays === undefined ? 30 : Number(requestedDays);
  if (!HOTSPOT_PERIODS.includes(days) || String(days) !== String(requestedDays ?? days).trim()) {
    throw new AppError('Hotspot period must be 7, 30, or 90 days', 400, 'VALIDATION_ERROR');
  }

  const hostelId = usersRepo.findStaffHostelId(requester.userId);
  const rows = complaintsRepo.complaintHotspots(hostelId, days, 8);
  const locations = rows.map((row, index) => ({
    rank: index + 1,
    hostel_id: row.hostel_id,
    hostel_name: row.hostel_name,
    room_number: row.room_number,
    location_label: `${row.hostel_name} · Room ${row.room_number}`,
    complaint_count: row.complaint_count,
    previous_count: row.previous_count,
    change: row.complaint_count - row.previous_count,
    trend: trendFor(row.complaint_count, row.previous_count),
    open_count: row.open_count,
    critical_count: row.critical_count,
    overdue_count: row.overdue_count,
    dominant_category: row.dominant_category,
    dominant_category_count: row.dominant_category_count,
    latest_created_at: row.latest_created_at,
    risk_score: row.risk_score,
    risk_level: riskLevel(row.risk_score),
    recommended_action: recommendedAction(row),
  }));

  return {
    period_days: days,
    comparison_days: days,
    scope: hostelId === null ? 'all_hostels' : 'managed_hostel',
    summary: {
      locations: rows[0]?.total_locations ?? 0,
      complaints: rows[0]?.period_complaints ?? 0,
      high_risk_locations: rows[0]?.high_risk_locations ?? 0,
      top_location: locations[0]?.location_label ?? null,
    },
    locations,
  };
}

module.exports = { studentDashboard, adminDashboard, complaintHotspots };
