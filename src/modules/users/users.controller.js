'use strict';

// Thin HTTP layer for the users module: parse the request, call the service,
// shape the response. No business logic here.
const usersService = require('./users.service');

function me(req, res, next) {
  try {
    res.json(usersService.getProfile(req.user.userId));
  } catch (err) {
    next(err);
  }
}

function updateMe(req, res, next) {
  try {
    res.json(usersService.updateProfile(req.user.userId, req.body));
  } catch (err) {
    next(err);
  }
}

function listStudents(req, res, next) {
  try {
    res.json(usersService.listStudents(req.user));
  } catch (err) {
    next(err);
  }
}

module.exports = { me, updateMe, listStudents };
