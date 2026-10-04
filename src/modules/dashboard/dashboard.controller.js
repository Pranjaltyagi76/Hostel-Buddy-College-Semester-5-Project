'use strict';

const dashboardService = require('./dashboard.service');

async function student(req, res, next) {
  try {
    res.json((await dashboardService.studentDashboard(req.user.userId)));
  } catch (err) {
    next(err);
  }
}

async function admin(req, res, next) {
  try {
    res.json((await dashboardService.adminDashboard(req.user)));
  } catch (err) {
    next(err);
  }
}

async function hotspots(req, res, next) {
  try {
    res.json((await dashboardService.complaintHotspots(req.user, req.query.days)));
  } catch (err) {
    next(err);
  }
}

module.exports = { student, admin, hotspots };
