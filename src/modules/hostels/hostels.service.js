'use strict';

// Business logic for hostels.
//
// Reading the list is open to everyone — the registration form must offer a
// hostel before the visitor has any session. Everything that changes a hostel
// is restricted to the super admin at the route, because a manager must not be
// able to alter the structure that scopes their own authority.
const hostelsRepo = require('./hostels.repo');
const { AppError } = require('../../middleware/errorHandler');
const { isString, isNonEmptyString, toPositiveInt } = require('../../utils/validators');

const MAX_NAME = 100;
const MAX_LOCATION = 100;

function listAll() {
  return hostelsRepo.listAll();
}

function getOne(hostelId) {
  const id = toPositiveInt(hostelId);
  const hostel = id && hostelsRepo.findById(id);
  if (!hostel) throw new AppError('Hostel not found', 404, 'NOT_FOUND');
  return hostel;
}

// Validates the writable fields. Types are checked before values so a JSON
// object can never be coerced into a hostel name (the B8 lesson).
function validateFields({ hostel_name, location, capacity }) {
  if (!isNonEmptyString(hostel_name)) {
    throw new AppError('Hostel name is required', 400, 'VALIDATION_ERROR');
  }
  const name = hostel_name.trim();
  if (name.length > MAX_NAME) {
    throw new AppError(`Hostel name is too long (max ${MAX_NAME} characters)`, 400, 'VALIDATION_ERROR');
  }

  let cleanLocation = null;
  if (location !== undefined && location !== null && location !== '') {
    if (!isString(location)) {
      throw new AppError('Location must be text', 400, 'VALIDATION_ERROR');
    }
    cleanLocation = location.trim() || null;
    if (cleanLocation && cleanLocation.length > MAX_LOCATION) {
      throw new AppError(`Location is too long (max ${MAX_LOCATION} characters)`, 400, 'VALIDATION_ERROR');
    }
  }

  // Capacity is optional, but if given it must be a whole number above zero —
  // the same rule the schema's CHECK constraint enforces.
  let cleanCapacity = null;
  if (capacity !== undefined && capacity !== null && capacity !== '') {
    cleanCapacity = toPositiveInt(capacity);
    if (cleanCapacity === null) {
      throw new AppError('Capacity must be a whole number greater than zero', 400, 'VALIDATION_ERROR');
    }
  }

  return { name, location: cleanLocation, capacity: cleanCapacity };
}

function create(dto = {}) {
  const fields = validateFields(dto);

  if (hostelsRepo.findByName(fields.name)) {
    throw new AppError('A hostel with this name already exists', 409, 'HOSTEL_NAME_TAKEN');
  }

  try {
    return hostelsRepo.create(fields);
  } catch (err) {
    // Backstop for the race between the check above and the insert.
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new AppError('A hostel with this name already exists', 409, 'HOSTEL_NAME_TAKEN');
    }
    throw err;
  }
}

function update(hostelId, dto = {}) {
  const existing = getOne(hostelId);
  const fields = validateFields(dto);

  // Renaming onto another hostel's name is a conflict; keeping your own is not.
  const clash = hostelsRepo.findByName(fields.name);
  if (clash && clash.hostel_id !== existing.hostel_id) {
    throw new AppError('A hostel with this name already exists', 409, 'HOSTEL_NAME_TAKEN');
  }

  return hostelsRepo.update(existing.hostel_id, fields);
}

function remove(hostelId) {
  const existing = getOne(hostelId);
  const { students, managers, complaints } = hostelsRepo.usage(existing.hostel_id);

  if (students || managers || complaints) {
    const parts = [];
    if (students) parts.push(`${students} student${students === 1 ? '' : 's'}`);
    if (managers) parts.push(`${managers} manager${managers === 1 ? '' : 's'}`);
    if (complaints) parts.push(`${complaints} complaint${complaints === 1 ? '' : 's'}`);
    throw new AppError(
      `This hostel still has ${parts.join(', ')}. Move or remove them before deleting it.`,
      409,
      'HOSTEL_IN_USE'
    );
  }

  hostelsRepo.remove(existing.hostel_id);
  return { deleted: true, hostel_id: existing.hostel_id };
}

module.exports = { listAll, getOne, create, update, remove };
