'use strict';

// Business logic for the user resource: profile read/update and the admin
// student listing. Validation rules live here, not in the controller.
const usersRepo = require('./users.repo');
const { AppError } = require('../../middleware/errorHandler');

function getProfile(userId) {
  const user = usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  return user;
}

function updateProfile(userId, { name, room_number }) {
  const user = usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  // Only name and room number are editable; email and role are fixed.
  const newName = name === undefined ? user.name : String(name).trim();
  if (!newName) throw new AppError('Name cannot be empty', 400, 'VALIDATION_ERROR');
  if (newName.length > 100) throw new AppError('Name is too long (max 100 characters)', 400, 'VALIDATION_ERROR');

  let newRoom;
  if (room_number === undefined) {
    newRoom = user.room_number;
  } else {
    newRoom = room_number ? String(room_number).trim() : null;
    if (newRoom && newRoom.length > 20) {
      throw new AppError('Room number is too long (max 20 characters)', 400, 'VALIDATION_ERROR');
    }
  }

  return usersRepo.updateProfile(userId, { name: newName, roomNumber: newRoom });
}

function listStudents() {
  return usersRepo.listStudents();
}

module.exports = { getProfile, updateProfile, listStudents };
