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

function listManagers(req, res, next) {
  try {
    res.json(usersService.listManagers());
  } catch (err) {
    next(err);
  }
}

async function createManager(req, res, next) {
  try {
    res.status(201).json(await usersService.createManager(req.body));
  } catch (err) {
    next(err);
  }
}

module.exports = { me, updateMe, listStudents, listManagers, createManager };
