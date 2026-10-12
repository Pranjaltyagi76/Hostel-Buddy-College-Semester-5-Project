'use strict';

// Business logic for the user resource: profile read/update and the admin
// student listing. Validation rules live here, not in the controller.
const bcrypt = require('bcryptjs');
const usersRepo = require('./users.repo');
const hostelsRepo = require('../hostels/hostels.repo');
const { validateAccountFields } = require('./account.validation');
const { AppError } = require('../../middleware/errorHandler');
const { isString, isNonEmptyString, toPositiveInt } = require('../../utils/validators');
const { ROLES } = require('../../config/constants');

const BCRYPT_ROUNDS = 10;

async function getProfile(userId) {
  const user = (await usersRepo.findById(userId));
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  return user;
}

async function updateProfile(userId, { name, room_number }) {
  const user = (await usersRepo.findById(userId));
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  // Only name and room number are editable; email and role are fixed.
  // Omitting a field keeps the stored value; sending one of the wrong type is
  // a validation error rather than something to coerce into a string.
  let newName;
  if (name === undefined) {
    newName = user.name;
  } else {
    if (!isNonEmptyString(name)) throw new AppError('Name cannot be empty', 400, 'VALIDATION_ERROR');
    newName = name.trim();
    if (newName.length > 100) {
      throw new AppError('Name is too long (max 100 characters)', 400, 'VALIDATION_ERROR');
    }
  }

  // Room number lives on the STUDENT subtype, so it only applies to students.
  // Leaving it undefined for staff means the repository skips that update
  // entirely rather than writing to a row that does not exist.
  let newRoom;
  if (user.role !== ROLES.STUDENT || room_number === undefined) {
    newRoom = undefined;
  } else if (room_number === null || room_number === '') {
    newRoom = null;
  } else {
    if (!isString(room_number)) {
      throw new AppError('Room number must be text', 400, 'VALIDATION_ERROR');
    }
    newRoom = room_number.trim() || null;
    if (newRoom && newRoom.length > 20) {
      throw new AppError('Room number is too long (max 20 characters)', 400, 'VALIDATION_ERROR');
    }
  }

  return (await usersRepo.updateProfile(userId, { name: newName, roomNumber: newRoom }));
}

// Lists students for a member of staff.
//
// A manager sees only their own hostel; a super admin has no hostel and so
// sees every student. The scope is resolved here from the database rather than
// taken from the request, so a caller cannot widen it by asking.
async function listStudents(requester) {
  const hostelId = (await usersRepo.findStaffHostelId(requester.userId));
  return (await usersRepo.listStudents({ hostelId }));
}

// --- Manager provisioning (super admin only, enforced at the route) ---

async function listManagers() {
  return (await usersRepo.listManagers());
}

// Creates a manager account bound to one hostel.
//
// Managers are provisioned, never self-registered: there is no public path to
// this, because an account that can act on other people's complaints must be
// granted deliberately.
async function createManager({ name, email, password, hostel_id } = {}) {
  const { name: cleanName, email: normalizedEmail } = validateAccountFields({ name, email, password });

  const hostelId = toPositiveInt(hostel_id);
  if (hostelId === null) {
    throw new AppError('Please select a hostel for this manager', 400, 'VALIDATION_ERROR');
  }
  if (!(await hostelsRepo.exists(hostelId))) {
    throw new AppError('The selected hostel does not exist', 400, 'VALIDATION_ERROR');
  }

  if ((await usersRepo.findByEmail(normalizedEmail))) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return (await usersRepo.createUser({
      name: cleanName,
      email: normalizedEmail,
      passwordHash,
      role: ROLES.MANAGER,
      hostelId,
    }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
    }
    throw err;
  }
}

// Removes a student. Only the respective hostel manager can remove students;
// super admin has view-only access.
async function deleteStudent(requester, targetStudentId) {
  if (requester.role === ROLES.SUPER_ADMIN) {
    throw new AppError('Super admin cannot remove students; student removal must be handled by the respective hostel manager', 403, 'FORBIDDEN');
  }
  if (requester.role !== ROLES.MANAGER) {
    throw new AppError('Only the respective hostel manager can remove students', 403, 'FORBIDDEN');
  }

  const studentId = toPositiveInt(targetStudentId);
  if (!studentId) {
    throw new AppError('Invalid student ID', 400, 'VALIDATION_ERROR');
  }

  const student = (await usersRepo.findById(studentId));
  if (!student || student.role !== ROLES.STUDENT) {
    throw new AppError('Student not found', 404, 'NOT_FOUND');
  }

  const managerHostelId = (await usersRepo.findStaffHostelId(requester.userId));
  if (!managerHostelId || student.hostel_id !== managerHostelId) {
    throw new AppError('You do not have permission to remove students from another hostel', 403, 'FORBIDDEN');
  }

  return (await usersRepo.deleteStudent(studentId));
}

// Removes a manager. Super-admin only (guarded at route level as well).
async function deleteManager(requester, targetManagerId) {
  const managerId = toPositiveInt(targetManagerId);
  if (!managerId) {
    throw new AppError('Invalid manager ID', 400, 'VALIDATION_ERROR');
  }

  const manager = (await usersRepo.findById(managerId));
  if (!manager || manager.role !== ROLES.MANAGER) {
    throw new AppError('Manager not found', 404, 'NOT_FOUND');
  }

  if (requester.userId === managerId) {
    throw new AppError('You cannot delete your own account', 400, 'VALIDATION_ERROR');
  }

  return (await usersRepo.deleteManager(managerId));
}

module.exports = {
  getProfile,
  updateProfile,
  listStudents,
  listManagers,
  createManager,
  deleteStudent,
  deleteManager,
};

