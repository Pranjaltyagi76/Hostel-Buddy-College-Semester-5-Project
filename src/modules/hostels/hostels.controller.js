'use strict';

const hostelsService = require('./hostels.service');

function list(req, res, next) {
  try {
    res.json(hostelsService.listAll());
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
