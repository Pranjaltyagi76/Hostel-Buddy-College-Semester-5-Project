'use strict';

const express = require('express');
const controller = require('./users.controller');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');

const router = express.Router();

// Any authenticated user can read and update their own profile.
router.get('/me', requireAuth, controller.me);
router.put('/me', requireAuth, controller.updateMe);

// Only the administrator can list students.
router.get('/', requireAuth, requireRole(ROLES.ADMIN), controller.listStudents);

module.exports = router;
