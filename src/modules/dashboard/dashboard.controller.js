'use strict';

const dashboardService = require('./dashboard.service');

function student(req, res, next) {
  try {
    res.json(dashboardService.studentDashboard(req.user.userId));
  } catch (err) {
    next(err);
  }
}

function admin(req, res, next) {
  try {
    res.json(dashboardService.adminDashboard(req.user));
  } catch (err) {
    next(err);
  }
}

module.exports = { student, admin };
