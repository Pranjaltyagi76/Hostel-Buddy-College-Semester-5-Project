'use strict';

const hostelsService = require('./hostels.service');

function list(req, res, next) {
  try {
    res.json(hostelsService.listAll());
  } catch (err) {
    next(err);
  }
}

function create(req, res, next) {
  try {
    res.status(201).json(hostelsService.create(req.body));
  } catch (err) {
    next(err);
  }
}

function update(req, res, next) {
  try {
    res.json(hostelsService.update(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}

function remove(req, res, next) {
  try {
    res.json(hostelsService.remove(req.params.id));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
