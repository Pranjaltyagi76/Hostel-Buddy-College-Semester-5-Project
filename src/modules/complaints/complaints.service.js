'use strict';

// Business logic for complaints. Every rule that protects a complaint lives
// here (ownership, "edit only while Pending", the status lifecycle, and now
// hostel scoping) so it holds no matter which route or caller invokes it.
const complaintsRepo = require('./complaints.repo');
const usersRepo = require('../users/users.repo');
const { removeUploadedFile } = require('../../middleware/upload');
const { AppError } = require('../../middleware/errorHandler');
const { CATEGORIES, STATUSES, STAFF_ROLES } = require('../../config/constants');
const { isString, isNonEmptyString, isTruthyFlag, toPositiveInt } = require('../../utils/validators');

const MAX_DESCRIPTION = 1000;
const MAX_REMARKS = 1000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// A complaint only ever moves forward along STATUSES (FR-14). Re-sending the
// current status is allowed so staff can edit remarks without a status change;
// anything that would move backwards is rejected.
const STATUS_ORDER = new Map(STATUSES.map((s, i) => [s, i]));

// Statuses at or past "Resolved" are the ones that carry a resolution date.
const RESOLVED_INDEX = STATUS_ORDER.get('Resolved');

function isStaff(requester) {
  return STAFF_ROLES.includes(requester.role);
}

// The hostel a member of staff may act within: a manager's own hostel, or null
// for a super admin (unscoped). Read from the database on each call rather than
// taken from the request or the token, so a caller can never widen their own
// scope and a reassignment takes effect immediately.
function staffScope(requester) {
  return usersRepo.findStaffHostelId(requester.userId);
}

// Refuses a member of staff access to a complaint outside their hostel.
//
// A super admin has no scope and passes everything. A manager passes only
// complaints belonging to their hostel. This is the single place that decision
// is made, so every staff operation inherits it.
function assertWithinScope(requester, complaint) {
  const scope = staffScope(requester);
  if (scope !== null && complaint.hostel_id !== scope) {
    throw new AppError(
      'This complaint belongs to another hostel',
      403,
      'FORBIDDEN'
    );
  }
}

function validateCategory(category) {
  if (!isString(category) || !CATEGORIES.includes(category)) {
    throw new AppError('Please select a valid complaint category', 400, 'VALIDATION_ERROR');
  }
}

function validateDescription(description) {
  if (!isNonEmptyString(description)) {
    throw new AppError('Description is required', 400, 'VALIDATION_ERROR');
  }
  const value = description.trim();
  if (value.length > MAX_DESCRIPTION) {
    throw new AppError(`Description is too long (max ${MAX_DESCRIPTION} characters)`, 400, 'VALIDATION_ERROR');
  }
  return value;
}

// The complaint's hostel is taken from the student's own record, never from
// the request. A student cannot file a complaint against a hostel they do not
// belong to, because they are never asked which hostel it is.
function createComplaint(studentId, { category, description } = {}, imageUrl = null) {
  validateCategory(category);
  const cleanDescription = validateDescription(description);

  const student = usersRepo.findById(studentId);
  if (!student || !student.hostel_id) {
    throw new AppError('Your account is not linked to a hostel', 400, 'NO_HOSTEL');
  }

  return complaintsRepo.create({
    studentId,
    hostelId: student.hostel_id,
    category,
    description: cleanDescription,
    imageUrl,
  });
}

function listMine(studentId) {
  return complaintsRepo.findByStudent(studentId);
}

// A complaint is readable by its author, or by staff within scope.
function getOne(requester, complaintId) {
  const complaint = complaintsRepo.findById(complaintId);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');

  if (complaint.student_id === requester.userId) return complaint;

  if (isStaff(requester)) {
    assertWithinScope(requester, complaint);
    return complaint;
  }

  throw new AppError('You do not have permission to view this complaint', 403, 'FORBIDDEN');
}

// Load a complaint and assert the student owns it AND it is still Pending.
// This is the core FR-9 guard; enforced in the service, not just the route.
function loadOwnedPending(studentId, complaintId) {
  const complaint = complaintsRepo.findById(complaintId);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');
  if (complaint.student_id !== studentId) {
    throw new AppError('You do not have permission to modify this complaint', 403, 'FORBIDDEN');
  }
  if (complaint.status !== 'Pending') {
    throw new AppError('This complaint can no longer be edited or deleted because it is already being handled', 409, 'NOT_PENDING');
  }
  return complaint;
}

function updateComplaint(studentId, complaintId, { category, description, remove_image } = {}, newImageUrl = null) {
  const complaint = loadOwnedPending(studentId, complaintId);

  const newCategory = category === undefined ? complaint.category : category;
  validateCategory(newCategory);
  const newDescription =
    description === undefined ? complaint.problem_description : validateDescription(description);

  // Image rules, in priority order: a newly uploaded file replaces whatever was
  // there; otherwise an explicit "remove" clears it; otherwise it is untouched.
  let imageUrl = complaint.image_url;
  if (newImageUrl) {
    imageUrl = newImageUrl;
    if (complaint.image_url) removeUploadedFile(complaint.image_url);
  } else if (isTruthyFlag(remove_image) && complaint.image_url) {
    imageUrl = null;
    removeUploadedFile(complaint.image_url);
  }

  return complaintsRepo.update(complaintId, {
    category: newCategory,
    description: newDescription,
    imageUrl,
  });
}

function deleteComplaint(studentId, complaintId) {
  const complaint = loadOwnedPending(studentId, complaintId);
  complaintsRepo.remove(complaintId);
  if (complaint.image_url) removeUploadedFile(complaint.image_url);
  return { deleted: true, complaint_id: complaint.complaint_id };
}

// --- Staff operations ---

function pageOrDefault(value, fallback) {
  return toPositiveInt(value) ?? fallback;
}

// Lists complaints for a member of staff, with optional search and filters.
//
// The hostel filter is resolved here from the caller's own record and passed
// to the repository, so a manager's list is narrowed in SQL. It is never taken
// from the query string — a manager cannot ask to see another hostel.
function listAll(requester, { q, category, status, page, limit } = {}) {
  if (category && !CATEGORIES.includes(category)) {
    throw new AppError('Invalid category filter', 400, 'VALIDATION_ERROR');
  }
  if (status && !STATUSES.includes(status)) {
    throw new AppError('Invalid status filter', 400, 'VALIDATION_ERROR');
  }

  const pageNum = pageOrDefault(page, 1);
  const pageSize = Math.min(pageOrDefault(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  const { rows, total, page: effectivePage, totalPages } = complaintsRepo.search({
    q,
    category,
    status,
    hostelId: staffScope(requester),
    page: pageNum,
    limit: pageSize,
  });

  return {
    data: rows,
    pagination: { page: effectivePage, limit: pageSize, total, totalPages },
  };
}

// Reject a status change that would move a complaint backwards through the
// lifecycle. Returning to an earlier state is what previously left rows marked
// Pending while still carrying a resolution date.
function validateTransition(from, to) {
  if (STATUS_ORDER.get(to) < STATUS_ORDER.get(from)) {
    throw new AppError(
      `A complaint cannot go back from ${from} to ${to}. The lifecycle only moves forward: ${STATUSES.join(' → ')}.`,
      409,
      'INVALID_TRANSITION'
    );
  }
}

// Advance a complaint's status and record remarks.
function updateStatus(requester, complaintId, { status, admin_remarks } = {}) {
  if (!isString(status) || !STATUSES.includes(status)) {
    throw new AppError('Please provide a valid status', 400, 'VALIDATION_ERROR');
  }

  const complaint = complaintsRepo.findById(complaintId);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');

  // A manager may only act on their own hostel's complaints. Checked before
  // anything is written, and before the transition is even considered.
  assertWithinScope(requester, complaint);

  validateTransition(complaint.status, status);

  // Remarks are optional: undefined keeps the existing note, an empty/null
  // value clears it, a string replaces it. A non-string is a validation error.
  let remarks;
  if (admin_remarks === undefined) {
    remarks = complaint.admin_remarks;
  } else if (admin_remarks === null) {
    remarks = null;
  } else if (!isString(admin_remarks)) {
    throw new AppError('Remarks must be text', 400, 'VALIDATION_ERROR');
  } else {
    const trimmed = admin_remarks.trim();
    if (!trimmed) {
      remarks = null;
    } else if (trimmed.length > MAX_REMARKS) {
      throw new AppError(`Remarks are too long (max ${MAX_REMARKS} characters)`, 400, 'VALIDATION_ERROR');
    } else {
      remarks = trimmed;
    }
  }

  // Record the resolution time only the FIRST time it reaches Resolved or
  // beyond, so later edits or a move to Closed never reset it.
  const setResolvedAt =
    STATUS_ORDER.get(status) >= RESOLVED_INDEX && !complaint.resolved_at;

  return complaintsRepo.updateStatus(complaintId, { status, adminRemarks: remarks, setResolvedAt });
}

module.exports = {
  createComplaint,
  listMine,
  getOne,
  updateComplaint,
  deleteComplaint,
  listAll,
  updateStatus,
  staffScope,
};
