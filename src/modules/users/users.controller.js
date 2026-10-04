'use strict';

// Thin HTTP layer for the users module: parse the request, call the service,
// shape the response. No business logic here.
const usersService = require('./users.service');

async function me(req, res, next) {
  try {
    res.json((await usersService.getProfile(req.user.userId)));
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    res.json((await usersService.updateProfile(req.user.userId, req.body)));
  } catch (err) {
    next(err);
  }
}

async function listStudents(req, res, next) {
  try {
    res.json((await usersService.listStudents(req.user)));
  } catch (err) {
    next(err);
  }
}

async function listManagers(req, res, next) {
  try {
    res.json((await usersService.listManagers()));
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
