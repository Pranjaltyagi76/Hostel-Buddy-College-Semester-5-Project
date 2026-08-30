'use strict';

// Business logic for complaints. Every rule that protects a complaint lives
// here (ownership, "edit only while Pending", the status lifecycle) so it holds
// no matter which route or caller invokes the operation.
const complaintsRepo = require('./complaints.repo');
const { removeUploadedFile } = require('../../middleware/upload');
const { AppError } = require('../../middleware/errorHandler');
const { CATEGORIES, STATUSES, ROLES } = require('../../config/constants');
const { isString, isNonEmptyString, isTruthyFlag } = require('../../utils/validators');

const MAX_DESCRIPTION = 1000;
const MAX_REMARKS = 1000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// A complaint only ever moves forward along STATUSES (FR-14). Re-sending the
// current status is allowed so the admin can edit remarks without a status
// change; anything that would move backwards is rejected.
const STATUS_ORDER = new Map(STATUSES.map((s, i) => [s, i]));

// Statuses at or past "Resolved" are the ones that carry a resolution date.
const RESOLVED_INDEX = STATUS_ORDER.get('Resolved');

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

function createComplaint(userId, { category, description } = {}, imageUrl = null) {
  validateCategory(category);
  const cleanDescription = validateDescription(description);
  return complaintsRepo.create({ userId, category, description: cleanDescription, imageUrl });
}

function listMine(userId) {
  return complaintsRepo.findByUser(userId);
}

// A complaint is readable by its owner or by an admin.
function getOne(requester, id) {
  const complaint = complaintsRepo.findById(id);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');

  const isOwner = complaint.user_id === requester.userId;
  const isAdmin = requester.role === ROLES.ADMIN;
  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to view this complaint', 403, 'FORBIDDEN');
  }
  return complaint;
}

// Load a complaint and assert the student owns it AND it is still Pending.
// This is the core FR-9 guard; enforced in the service, not just the route.
function loadOwnedPending(userId, id) {
  const complaint = complaintsRepo.findById(id);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');
  if (complaint.user_id !== userId) {
    throw new AppError('You do not have permission to modify this complaint', 403, 'FORBIDDEN');
  }
  if (complaint.status !== 'Pending') {
    throw new AppError('This complaint can no longer be edited or deleted because it is already being handled', 409, 'NOT_PENDING');
  }
  return complaint;
}

function updateComplaint(userId, id, { category, description, remove_image } = {}, newImageUrl = null) {
  const complaint = loadOwnedPending(userId, id);

  const newCategory = category === undefined ? complaint.category : category;
  validateCategory(newCategory);
  const newDescription =
    description === undefined ? complaint.description : validateDescription(description);

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

  return complaintsRepo.update(id, { category: newCategory, description: newDescription, imageUrl });
}

function deleteComplaint(userId, id) {
  const complaint = loadOwnedPending(userId, id);
  complaintsRepo.remove(id);
  if (complaint.image_url) removeUploadedFile(complaint.image_url);
  return { deleted: true, id: complaint.id };
}

// --- Admin operations ---

// Coerce an incoming page/limit query value to a sane positive integer.
function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// List every complaint with optional search (id / student name / room),
// category and status filters, and pagination.
function listAll({ q, category, status, page, limit } = {}) {
  if (category && !CATEGORIES.includes(category)) {
    throw new AppError('Invalid category filter', 400, 'VALIDATION_ERROR');
  }
  if (status && !STATUSES.includes(status)) {
    throw new AppError('Invalid status filter', 400, 'VALIDATION_ERROR');
  }

  const pageNum = toPositiveInt(page, 1);
  const pageSize = Math.min(toPositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  // The repository clamps the requested page to the last real page, so the
  // pagination block it returns can never describe a page that doesn't exist.
  const { rows, total, page: effectivePage, totalPages } = complaintsRepo.search({
    q,
    category,
    status,
    page: pageNum,
    limit: pageSize,
  });

  return {
    data: rows,
    pagination: {
      page: effectivePage,
      limit: pageSize,
      total,
      totalPages,
    },
  };
}

// Reject a status change that would move a complaint backwards through the
// lifecycle. Returning to an earlier state is what previously left rows marked
// Pending while still carrying a resolution date.
function validateTransition(from, to) {
  const fromIndex = STATUS_ORDER.get(from);
  const toIndex = STATUS_ORDER.get(to);

  if (toIndex < fromIndex) {
    throw new AppError(
      `A complaint cannot go back from ${from} to ${to}. The lifecycle only moves forward: ${STATUSES.join(' → ')}.`,
      409,
      'INVALID_TRANSITION'
    );
  }
}

// Advance a complaint's status and record remarks. Only the admin reaches
// this (enforced at the route); business rules for status live here.
function updateStatus(id, { status, admin_remarks } = {}) {
  if (!isString(status) || !STATUSES.includes(status)) {
    throw new AppError('Please provide a valid status', 400, 'VALIDATION_ERROR');
  }

  const complaint = complaintsRepo.findById(id);
  if (!complaint) throw new AppError('Complaint not found', 404, 'NOT_FOUND');

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

  // Record the resolution time only the FIRST time it becomes Resolved, so
  // later edits or a move to Closed never reset it.
  const setResolvedAt =
    STATUS_ORDER.get(status) >= RESOLVED_INDEX && !complaint.resolved_at;

  return complaintsRepo.updateStatus(id, { status, adminRemarks: remarks, setResolvedAt });
}

module.exports = {
  createComplaint,
  listMine,
  getOne,
  updateComplaint,
  deleteComplaint,
  listAll,
  updateStatus,
};
