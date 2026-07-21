'use strict';

const express = require('express');
const controller = require('./dashboard.controller');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');

const router = express.Router();

// Each role sees its own dashboard.
router.get('/student', requireAuth, requireRole(ROLES.STUDENT), controller.student);
router.get('/admin', requireAuth, requireRole(ROLES.ADMIN), controller.admin);

module.exports = router;
