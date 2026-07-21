'use strict';

// Business logic for complaints. Every rule that protects a complaint lives
// here (ownership, "edit only while Pending") so it holds no matter which
// route or caller invokes the operation.
const complaintsRepo = require('./complaints.repo');
const { removeUploadedFile } = require('../../middleware/upload');
const { AppError } = require('../../middleware/errorHandler');
const { CATEGORIES, ROLES } = require('../../config/constants');

const MAX_DESCRIPTION = 1000;

function validateCategory(category) {
  if (!CATEGORIES.includes(category)) {
    throw new AppError('Please select a valid complaint category', 400, 'VALIDATION_ERROR');
  }
}

function validateDescription(description) {
  const value = description == null ? '' : String(description).trim();
  if (!value) throw new AppError('Description is required', 400, 'VALIDATION_ERROR');
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

function updateComplaint(userId, id, { category, description } = {}, newImageUrl = null) {
  const complaint = loadOwnedPending(userId, id);

  const newCategory = category === undefined ? complaint.category : category;
  validateCategory(newCategory);
  const newDescription =
    description === undefined ? complaint.description : validateDescription(description);

  // If a new image was uploaded, use it and remove the previous file.
  let imageUrl = complaint.image_url;
  if (newImageUrl) {
    imageUrl = newImageUrl;
    if (complaint.image_url) removeUploadedFile(complaint.image_url);
  }

  return complaintsRepo.update(id, { category: newCategory, description: newDescription, imageUrl });
}

function deleteComplaint(userId, id) {
  const complaint = loadOwnedPending(userId, id);
  complaintsRepo.remove(id);
  if (complaint.image_url) removeUploadedFile(complaint.image_url);
  return { deleted: true, id: complaint.id };
}

module.exports = {
  createComplaint,
  listMine,
  getOne,
  updateComplaint,
  deleteComplaint,
};
