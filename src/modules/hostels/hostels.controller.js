'use strict';

const hostelsService = require('./hostels.service');

async function list(req, res, next) {
  try {
    res.json((await hostelsService.listAll()));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json((await hostelsService.create(req.body)));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    res.json((await hostelsService.update(req.params.id, req.body)));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    res.json((await hostelsService.remove(req.params.id)));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
